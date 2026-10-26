package jp.rdlabo.workerscapacitor;
import java.lang.reflect.*;
import java.util.*;
import io.netty.channel.*;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.ssl.SslCloseCompletionEvent;
import io.netty.buffer.Unpooled;
import com.getcapacitor.JSObject;
public class EofHarness {
 static Class<?> type;
 static void set(Object c,String k,Object v)throws Exception{Field f=type.getDeclaredField(k);f.setAccessible(true);f.set(c,v);}
 static class Result implements WorkerSockets.Result {
  final String name; final List<String> events; final List<JSObject> values=new ArrayList<>();
  Result(String name,List<String> events){this.name=name;this.events=events;}
  public void resolve(JSObject value){values.add(value);events.add(name+":"+(value==null?"end":value.containsKey("chunk")?"bytes="+java.util.Base64.getDecoder().decode((String)value.get("chunk")).length:value));}
  public void reject(String s){throw new AssertionError(name+" reject "+s);}
 }
 public static void main(String[] args)throws Exception {
  List<String> events=new ArrayList<>();
  WorkerSockets outer=new WorkerSockets();type=Class.forName("jp.rdlabo.workerscapacitor.WorkerSockets$Connection");
  Constructor<?> constructor=type.getDeclaredConstructors()[0];constructor.setAccessible(true);
  Object c=constructor.newInstance(outer,"test",new Result("opening",events));
  EmbeddedChannel embedded=new EmbeddedChannel((ChannelHandler)c);
  SocketChannel proxy=(SocketChannel)Proxy.newProxyInstance(EofHarness.class.getClassLoader(),new Class[]{SocketChannel.class},(p,m,a)->{
   if(m.getName().equals("read"))return p;
   if(m.getName().equals("eventLoop"))return embedded.eventLoop();
   if(m.getName().equals("close"))return embedded.newSucceededFuture();
   if(m.getName().equals("isActive"))return true;
   throw new UnsupportedOperationException(m.toString());
  });
  set(c,"channel",proxy);set(c,"ready",true);set(c,"encrypted",true);set(c,"count",65536);
  Result read=new Result("read",events),watch=new Result("watch",events);set(c,"reading",read);set(c,"watching",watch);
  ChannelHandlerContext context=embedded.pipeline().context((ChannelHandler)c);
  ChannelInboundHandler handler=(ChannelInboundHandler)c;
  handler.userEventTriggered(context,SslCloseCompletionEvent.SUCCESS);
  String mode=args.length==0?"close":args[0];
  if(mode.equals("inactive"))handler.channelInactive(context);
  if(mode.equals("shutdown"))handler.userEventTriggered(context,io.netty.channel.socket.ChannelInputShutdownEvent.INSTANCE);
  if(mode.equals("reset"))handler.exceptionCaught(context,new java.io.IOException("Connection reset"));
  // This is the same callback stack; no EmbeddedChannel task drain yet.
  handler.channelRead(context,Unpooled.wrappedBuffer(new byte[8192]));
  embedded.runPendingTasks();
  System.out.println(events);
  if(read.values.size()!=1||!read.values.get(0).containsKey("chunk")||java.util.Base64.getDecoder().decode((String)read.values.get(0).get("chunk")).length!=8192)throw new AssertionError("First read must contain 8192 bytes, not EOF");
  if(watch.values.size()!=1)throw new AssertionError("watch exactly once");
  Result next=new Result("next",events);set(c,"reading",next);
  Method drain=type.getDeclaredMethod("drain");drain.setAccessible(true);drain.invoke(c);
  if(next.values.size()!=1||!Boolean.TRUE.equals(next.values.get(0).get("eof")))throw new AssertionError("Subsequent read must EOF");
  handler.userEventTriggered(context,SslCloseCompletionEvent.SUCCESS);embedded.runPendingTasks();
  if(watch.values.size()!=1)throw new AssertionError("duplicate watch");
  System.out.println("PASS real WorkerSockets.Connection: "+events);
 }
}
