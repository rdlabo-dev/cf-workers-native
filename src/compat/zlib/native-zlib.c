// Owned bridge to zlib 1.3.1; the compiler port pins and verifies its source hash.
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <zlib.h>
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
struct Codec { z_stream stream; int encode, mode, ended; unsigned char *dictionary; unsigned dictionary_size; unsigned char pending[1024]; unsigned pending_size; unsigned char header[2]; unsigned header_size; };
API void* cz_create(int mode, int bits, int level, int memory, int strategy, const unsigned char* dictionary, unsigned length) {
 struct Codec* c=calloc(1,sizeof(*c)); if(!c)return NULL;
 c->mode=mode;c->encode=mode==1||mode==3||mode==5;
 if(mode==3||mode==4)bits+=16;else if(mode==7)bits+=32;else if(mode==5||mode==6)bits=-bits;
 int result=c->encode?deflateInit2(&c->stream,level,Z_DEFLATED,bits,memory,strategy):inflateInit2(&c->stream,bits);
 if(result!=Z_OK){free(c);return NULL;}
 if(length){c->dictionary=malloc(length);if(!c->dictionary){if(c->encode)deflateEnd(&c->stream);else inflateEnd(&c->stream);free(c);return NULL;}memcpy(c->dictionary,dictionary,length);c->dictionary_size=length;
  if(c->encode&&mode!=3)result=deflateSetDictionary(&c->stream,dictionary,length);
  else if(mode==6)result=inflateSetDictionary(&c->stream,dictionary,length);
  if(result!=Z_OK){if(c->encode)deflateEnd(&c->stream);else inflateEnd(&c->stream);free(c->dictionary);free(c);return NULL;}
 }
 return c;
}
API void cz_free(struct Codec* c){if(!c)return;if(c->encode)deflateEnd(&c->stream);else inflateEnd(&c->stream);free(c->dictionary);free(c);}
API int cz_reset(struct Codec* c){c->ended=0;c->pending_size=0;c->header_size=0;int r=c->encode?deflateReset(&c->stream):inflateReset(&c->stream);if(r==Z_OK&&c->dictionary_size&&((c->encode&&c->mode!=3)||c->mode==6))r=c->encode?deflateSetDictionary(&c->stream,c->dictionary,c->dictionary_size):inflateSetDictionary(&c->stream,c->dictionary,c->dictionary_size);return r;}
API int cz_params(struct Codec* c,int level,int strategy){if(c->mode!=1&&c->mode!=5)return Z_OK;c->stream.next_out=c->pending;c->stream.avail_out=sizeof(c->pending);int r=deflateParams(&c->stream,level,strategy);c->pending_size=sizeof(c->pending)-c->stream.avail_out;return r;}
API const char* cz_message(struct Codec* c){return c->stream.msg?c->stream.msg:"Zlib error";}
API int cz_process(struct Codec* c,const unsigned char* input,unsigned length,unsigned char* output,unsigned capacity,int flush,unsigned* state){
 unsigned prefix=c->pending_size<capacity?c->pending_size:capacity;
 if(prefix){memcpy(output,c->pending,prefix);memmove(c->pending,c->pending+prefix,c->pending_size-prefix);c->pending_size-=prefix;}
 if(prefix==capacity){state[0]=0;state[1]=length;return Z_OK;}
 c->stream.next_in=(Bytef*)input;c->stream.avail_in=length;c->stream.next_out=output+prefix;c->stream.avail_out=capacity-prefix;
 if(c->mode==7){unsigned n=0;while(c->header_size<2&&n<length)c->header[c->header_size++]=input[n++];if(c->header_size==2)c->mode=(c->header[0]==31&&c->header[1]==139)?4:2;}
 if(c->ended&&c->mode==4&&length&&input[0]){inflateReset(&c->stream);c->ended=0;}
 int result;
 do {
  result=c->encode?deflate(&c->stream,flush):inflate(&c->stream,flush);
  if(result==Z_NEED_DICT&&c->dictionary){result=inflateSetDictionary(&c->stream,c->dictionary,c->dictionary_size);if(result==Z_OK)result=inflate(&c->stream,flush);else if(result==Z_DATA_ERROR)result=Z_NEED_DICT;}
  if(result==Z_STREAM_END){c->ended=1;if(c->mode==4&&c->stream.avail_in&&c->stream.next_in[0]&&c->stream.avail_out){inflateReset(&c->stream);c->ended=0;continue;}}
  break;
 }while(1);
 state[0]=c->stream.avail_out;state[1]=c->stream.avail_in;
 if((result==Z_OK||result==Z_BUF_ERROR)&&flush==Z_FINISH&&c->stream.avail_out)return Z_BUF_ERROR;
 return result;
}
