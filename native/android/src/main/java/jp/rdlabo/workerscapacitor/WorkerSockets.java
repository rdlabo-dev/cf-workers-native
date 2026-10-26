package jp.rdlabo.workerscapacitor;

import android.util.Base64;
import com.getcapacitor.JSObject;
import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.ChannelInputShutdownEvent;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.handler.ssl.SslHandler;
import io.netty.handler.ssl.SslCloseCompletionEvent;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.*;

/** One bounded, independently half-closeable byte stream per JS socket. */
final class WorkerSockets {
    interface Result {
        void resolve(JSObject value);
        void reject(String message);
    }
    private final Map<String, Connection> connections = new ConcurrentHashMap<>();
    private EventLoopGroup group;
    private SSLContext tlsContext;
    private boolean stopped;
    private final java.util.concurrent.CompletableFuture<Void> terminated = new java.util.concurrent.CompletableFuture<>();
    private final class Connection extends SimpleChannelInboundHandler<ByteBuf> {
        final String id;
        final Result opening;
        final ArrayDeque<byte[]> chunks = new ArrayDeque<>();
        SocketChannel channel;
        Result reading, watching, upgrading;
        String host; int port;
        int count, offset;
        boolean ready, closed, eof, ended, writing, reset, encrypted, closeNotify, inboundEndQueued;
        Connection(String id, Result opening) { this.id=id; this.opening=opening; }
        void fail(String message) {
            if (closed) return;
            closed=true;
            if(upgrading!=null) { Result pending=upgrading; upgrading=null; pending.reject(message); }
            if (!ready) { ready=true; opening.reject(message); }
            if (reading!=null) {
                Result pending=reading; reading=null;
                // The pinned Workers transport reports peer reset as EOF.
                if(reset) { JSObject value=new JSObject(); value.put("eof",true); value.put("reset",true); pending.resolve(value); }
                else pending.reject(message);
            }
            if(watching!=null) { Result pending=watching; watching=null; if(reset) pending.resolve(null); else pending.reject(message); }
            chunks.clear();
            if(channel!=null) channel.close();
        }
        void finishInbound(ChannelHandlerContext context) {
            if(inboundEndQueued || eof || closed) return;
            inboundEndQueued=true;
            // SslHandler can complete its close future during a reentrant
            // unwrap, before the enclosing decode delivers its plaintext.
            // Publish EOF only after the current pipeline dispatch unwinds;
            // queued data must be drained before read/watch observe the end.
            context.executor().execute(() -> {
                inboundEndQueued=false;
                if(closed) return;
                eof=true; drain(); notifyEnd();
            });
        }
        void notifyEnd() {
            if(eof && chunks.isEmpty() && watching!=null) { Result pending=watching; watching=null; pending.resolve(null); }
        }
        void pump() {
            if(!closed && !eof && chunks.isEmpty()) channel.read();
        }
        void drain() {
            if(reading==null) return;
            JSObject value=new JSObject();
            if(!chunks.isEmpty()) {
                byte[] chunk=chunks.peek(); int size=Math.min(count,chunk.length-offset);
                value.put("chunk",Base64.encodeToString(chunk,offset,size,Base64.NO_WRAP));
                offset+=size; if(offset==chunk.length) { chunks.remove(); offset=0; }
            } else if(eof) value.put("eof",true);
            else { pump(); return; }
            Result pending=reading; reading=null; pending.resolve(value); notifyEnd(); pump();
        }
        @Override protected void channelRead0(ChannelHandlerContext context,ByteBuf input) {
            if(closed || !input.isReadable()) return;
            byte[] chunk=new byte[input.readableBytes()]; input.readBytes(chunk); chunks.add(chunk); drain();
        }
        @Override public void channelReadComplete(ChannelHandlerContext context) { if(!ready && !closed) context.read(); else pump(); }
        @Override public void userEventTriggered(ChannelHandlerContext context,Object event) {
            if(event instanceof SslCloseCompletionEvent) {
                SslCloseCompletionEvent tlsClose=(SslCloseCompletionEvent)event;
                if(tlsClose.isSuccess()) { closeNotify=true; finishInbound(context); }
                else if(ready && encrypted && !closed) { fail("TLS connection closed without close_notify"); return; }
                context.fireUserEventTriggered(event);
            } else if(event instanceof ChannelInputShutdownEvent) {
                if(!ready || upgrading!=null) { fail("TLS connection closed before handshake completed"); return; }
                if(encrypted && !closeNotify) { fail("TLS connection closed without close_notify"); return; }
                finishInbound(context);
            }
            else context.fireUserEventTriggered(event);
        }
        @Override public void channelInactive(ChannelHandlerContext context) {
            if(!closed) {
                if(!ready || upgrading!=null) { fail("Socket closed before handshake completed"); return; }
                if(encrypted && !closeNotify) { fail("TLS connection closed without close_notify"); return; }
                finishInbound(context);
            }
        }
        @Override public void exceptionCaught(ChannelHandlerContext context,Throwable error) {
            boolean peerReset = error instanceof java.io.IOException && String.valueOf(error.getMessage()).toLowerCase(java.util.Locale.ROOT).contains("reset");
            // Workers' plain TCP reset-as-EOF behavior must not turn a truncated
            // authenticated TLS stream into a successful end.
            if(encrypted && peerReset && closeNotify) { finishInbound(context); return; }
            reset = !encrypted && peerReset;
            fail(encrypted && peerReset ? "TLS connection closed without close_notify" : "Socket failed: "+error.getMessage());
        }
    }
    synchronized void open(String id,String host,int port,boolean tls,Result result) { open(id,host,port,tls,null,result); }
    synchronized void open(String id,String host,int port,boolean tls,String servername,Result result) {
        if(stopped || id==null || id.isEmpty() || connections.containsKey(id) || host==null || host.isEmpty() || port<1 || port>65535) { result.reject("Invalid socket open"); return; }
        try {
            final SSLEngine engine;
            if(tls) {
                // Android cannot resume HttpURLConnection's SSLSocket sessions in
                // an SSLEngine. Keep our session cache separate, using default trust.
                if(tlsContext==null) {
                    SSLContext context=SSLContext.getInstance("TLS");
                    context.init(null,null,null); tlsContext=context;
                }
                engine=tlsContext.createSSLEngine(servername==null || servername.isEmpty() ? host : servername,port); engine.setUseClientMode(true);
                SSLParameters parameters=engine.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS"); engine.setSSLParameters(parameters);
            } else engine=null;
            if(group==null) group=new NioEventLoopGroup(1);
            Connection connection=new Connection(id,result); connection.host=host; connection.port=port; connection.encrypted=tls; connections.put(id,connection);
            ChannelFuture future=new Bootstrap().group(group).channel(NioSocketChannel.class)
                .option(ChannelOption.AUTO_READ,false).option(ChannelOption.ALLOW_HALF_CLOSURE,true)
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS,30000)
                .option(ChannelOption.RCVBUF_ALLOCATOR,new FixedRecvByteBufAllocator(65536).maxMessagesPerRead(1))
                .handler(new ChannelInitializer<SocketChannel>() {
                    @Override protected void initChannel(SocketChannel channel) {
                        connection.channel=channel;
                        if(engine!=null) channel.pipeline().addLast(new SslHandler(engine));
                        channel.pipeline().addLast(connection);
                    }
                }).connect(host,port);
            connection.channel=(SocketChannel)future.channel();
            future.addListener(connected -> {
                if(!connected.isSuccess()) { connection.fail("Socket connect failed: "+connected.cause()); return; }
                Runnable ready=() -> {
                    if(connection.closed) return;
                    connection.ready=true;
                    JSObject value=new JSObject();
                    value.put("localAddress",authority(connection.channel.localAddress()));
                    value.put("remoteAddress",authority(connection.channel.remoteAddress())); result.resolve(value);
                    connection.channel.read();
                };
                if(engine==null) ready.run();
                else { connection.channel.pipeline().get(SslHandler.class).handshakeFuture().addListener(handshake -> {
                    if(handshake.isSuccess()) ready.run(); else connection.fail("TLS failed: "+handshake.cause());
                }); connection.channel.read(); }
            });
        } catch(Exception error) { Connection connection=connections.remove(id); if(connection!=null) connection.fail(error.toString()); else result.reject(error.toString()); }
    }
    void startTls(String id,String servername,Result result) {
        perform(id,result,connection -> {
            if(connection.ended || connection.eof || connection.writing || connection.upgrading!=null || connection.channel.pipeline().get(SslHandler.class)!=null) { result.reject("Socket cannot be upgraded"); return; }
            try {
                final SSLEngine engine;
                synchronized(this) {
                    if(tlsContext==null) { tlsContext=SSLContext.getInstance("TLS"); tlsContext.init(null,null,null); }
                    engine=tlsContext.createSSLEngine(servername==null || servername.isEmpty()?connection.host:servername,connection.port);
                }
                engine.setUseClientMode(true);
                SSLParameters parameters=engine.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS"); engine.setSSLParameters(parameters);
                connection.upgrading=result; connection.encrypted=true;
                JSObject moved=new JSObject(); moved.put("upgraded",true);
                if(connection.reading!=null) { Result pending=connection.reading; connection.reading=null; pending.resolve(moved); }
                if(connection.watching!=null) { Result pending=connection.watching; connection.watching=null; pending.resolve(moved); }
                ArrayDeque<byte[]> buffered=new ArrayDeque<>(connection.chunks); connection.chunks.clear();
                int firstOffset=connection.offset; connection.offset=0;
                SslHandler handler=new SslHandler(engine);
                connection.channel.pipeline().addFirst(handler);
                for(byte[] chunk:buffered) {
                    connection.channel.pipeline().fireChannelRead(Unpooled.wrappedBuffer(chunk,firstOffset,chunk.length-firstOffset)); firstOffset=0;
                }
                handler.handshakeFuture().addListener(handshake -> {
                    if(connection.closed) return;
                    if(!handshake.isSuccess()) { connection.fail("TLS failed: "+handshake.cause()); return; }
                    Result pending=connection.upgrading; connection.upgrading=null; pending.resolve(null); connection.pump();
                });
                connection.channel.read();
            } catch(Exception error) { result.reject(error.toString()); connection.fail(error.toString()); }
        });
    }
    private static String authority(java.net.InetSocketAddress address) {
        String host=address.getAddress().getHostAddress(); return (host.contains(":")?"["+host+"]":host)+":"+address.getPort();
    }
    private void perform(String id,Result result,java.util.function.Consumer<Connection> action) { perform(id,result,false,action); }
    private synchronized void perform(String id,Result result,boolean allowReset,java.util.function.Consumer<Connection> action) {
        if(id==null) { result.reject("Missing socket handle"); return; }
        Connection connection=connections.get(id);
        if(connection==null) { result.reject("Unknown socket handle"); return; }
        connection.channel.eventLoop().execute(() -> {
            if((connection.closed && !(allowReset && connection.reset)) || !connection.ready) result.reject("Socket is not connected"); else action.accept(connection);
        });
    }
    void watch(String id,Result result) {
        perform(id,result,true,connection -> {
            if(connection.reset) { result.resolve(null); return; }
            if(connection.watching!=null) { result.reject("Socket watch already pending"); return; }
            connection.watching=result; connection.notifyEnd();
        });
    }
    void read(String id,int count,Result result) {
        if(count<1 || count>65536) { result.reject("Invalid socket read size"); return; }
        perform(id,result,true,connection -> {
            if(connection.reset) { JSObject value=new JSObject(); value.put("eof",true); value.put("reset",true); result.resolve(value); return; }
            if(connection.reading!=null) { result.reject("Socket read already pending"); return; }
            connection.reading=result; connection.count=count; connection.drain();
        });
    }
    void write(String id,String encoded,Result result) {
        if(encoded == null || encoded.length() > 87384) { result.reject("Invalid socket chunk size"); return; }
        final byte[] chunk;
        try { chunk=Base64.decode(encoded,Base64.DEFAULT); } catch(Exception error) { result.reject("Invalid socket chunk"); return; }
        if(chunk.length>65536) { result.reject("Socket chunk exceeds limit"); return; }
        perform(id,result,connection -> {
            if(connection.ended || connection.writing || connection.upgrading!=null) { result.reject("Socket write unavailable"); return; }
            connection.writing=true;
            connection.channel.writeAndFlush(Unpooled.wrappedBuffer(chunk)).addListener(future -> {
                connection.writing=false;
                if(future.isSuccess()) result.resolve(null); else { result.reject("Socket write failed"); connection.fail("Socket write failed"); }
            });
        });
    }
    void end(String id,Result result) {
        perform(id,result,true,connection -> {
            if(connection.reset) { result.resolve(null); return; }
            if(connection.writing || connection.upgrading!=null) { result.reject("Socket write still pending"); return; }
            if(connection.ended) { result.resolve(null); return; }
            connection.ended=true;
            Runnable shutdownOutput=() -> {
                if(connection.eof && !connection.channel.isActive()) { result.resolve(null); return; }
                connection.channel.shutdownOutput().addListener(future -> {
                    if(future.isSuccess() || connection.eof) result.resolve(null);
                    else { result.reject("Socket end failed"); connection.fail("Socket end failed"); }
                });
            };
            SslHandler tls=connection.channel.pipeline().get(SslHandler.class);
            if(tls==null) shutdownOutput.run();
            else tls.closeOutbound().addListener(future -> {
                // TLS close_notify half-closes the TLS write side. Do not send
                // TCP FIN here: it can close a peer's raw transport before its
                // encrypted response has flushed. The read side owns final close.
                if(future.isSuccess()) result.resolve(null);
                else if(connection.eof) result.resolve(null);
                else { result.reject("TLS end failed"); connection.fail("TLS end failed"); }
            });
        });
    }
    synchronized void close(String id,Result result) {
        if(id==null) { result.reject("Missing socket handle"); return; }
        Connection connection=connections.remove(id);
        if(connection==null) { result.resolve(null); return; }
        connection.channel.eventLoop().execute(() -> { connection.fail("Socket closed"); connection.channel.close().addListener(future -> result.resolve(null)); });
    }
    synchronized java.util.concurrent.CompletionStage<Void> shutdown() {
        if(stopped) return terminated; stopped=true;
        for(Connection connection:connections.values()) connection.channel.eventLoop().execute(() -> connection.fail("Socket runtime closed"));
        connections.clear();
        if(group==null) terminated.complete(null);
        else group.shutdownGracefully(0,2,TimeUnit.SECONDS).addListener(future -> {
            if(future.isSuccess()) terminated.complete(null);
            else terminated.completeExceptionally(future.cause());
        });
        return terminated;
    }
}
