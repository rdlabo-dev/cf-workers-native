#include <emscripten.h>
#include <openssl/aead.h>
#include <openssl/cipher.h>
#include <openssl/err.h>
#include <openssl/ec.h>
#include <openssl/dh.h>
#include <openssl/bn.h>
#include <openssl/obj.h>
#include <openssl/mem.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <string.h>
#define API EMSCRIPTEN_KEEPALIVE
// Key decoding follows ncrypto v1.1.4 using the same BoringSSL parser as Workers.
static unsigned char *key_der;
static int key_der_size;
API void cipher_key_clear(void) {
 if(key_der){if(key_der_size>0)OPENSSL_cleanse(key_der,key_der_size);OPENSSL_free(key_der);}
 key_der=NULL;key_der_size=0;
}
API const unsigned char *cipher_key_data(void){return key_der;}
API int cipher_key_der_size(void){return key_der_size;}
struct key_password {const unsigned char *data;int size;};
static int key_password_cb(char *out,int capacity,int writing,void *opaque){
 (void)writing;struct key_password *pass=opaque;
 if(!pass || pass->size>capacity)return -1;
 if(pass->size)memcpy(out,pass->data,pass->size);return pass->size;
}
static int key_encrypted(const unsigned char *data,int size){
 if(size<2 || data[0]!=0x30)return 0;
 size_t offset=2,length=data[1];
 if(length&0x80){size_t count=length&0x7f;length=0;
  if(count>sizeof(size_t) || count+2>(size_t)size)return 0;
  for(size_t i=0;i<count;i++)length=(length<<8)|data[i+2];offset+=count;
 }
 return length && offset<(size_t)size && data[offset]!=2;
}
static EVP_PKEY *key_private(const unsigned char *data,int size,int pem,int type,struct key_password *pass){
 BIO *bio=BIO_new_mem_buf(data,size);if(!bio)return NULL;
 ERR_clear_error();EVP_PKEY *key=NULL;
 if(pem)key=PEM_read_bio_PrivateKey(bio,NULL,key_password_cb,pass);
 else if(type==1 || type==2)key=d2i_PrivateKey_bio(bio,NULL);
 else if(type==0){
  if(key_encrypted(data,size))key=d2i_PKCS8PrivateKey_bio(bio,NULL,key_password_cb,pass);
  else {PKCS8_PRIV_KEY_INFO *info=d2i_PKCS8_PRIV_KEY_INFO_bio(bio,NULL);if(info){key=EVP_PKCS82PKEY(info);PKCS8_PRIV_KEY_INFO_free(info);}}
 }
 BIO_free(bio);if(ERR_peek_error()){EVP_PKEY_free(key);key=NULL;}return key;
}
static EVP_PKEY *key_public(const unsigned char *data,int size,int pem,int type){
 EVP_PKEY *key=NULL;const unsigned char *cursor=data;
 if(!pem)return type==1?d2i_PublicKey(EVP_PKEY_RSA,NULL,&cursor,size):type==3?d2i_PUBKEY(NULL,&cursor,size):NULL;
 BIO *bio=BIO_new_mem_buf(data,size);if(!bio)return NULL;
 const char *labels[]={"PUBLIC KEY","RSA PUBLIC KEY","CERTIFICATE"};
 for(int i=0;i<3 && !key;i++){
  unsigned char *decoded=NULL;long length=0;BIO_reset(bio);ERR_clear_error();
  if(PEM_bytes_read_bio(&decoded,&length,NULL,labels[i],bio,NULL,NULL)!=1)continue;
  cursor=decoded;
  if(i==0)key=d2i_PUBKEY(NULL,&cursor,length);
  else if(i==1)key=d2i_PublicKey(EVP_PKEY_RSA,NULL,&cursor,length);
  else {X509 *cert=d2i_X509(NULL,&cursor,length);if(cert){key=X509_get_pubkey(cert);X509_free(cert);}}
  OPENSSL_free(decoded);
 }
 BIO_free(bio);return key;
}
// Returns 1 for public material, 2 for private material (including public fallback).
API int cipher_key_parse(const unsigned char *data,int size,int pem,int private_key,int type,const unsigned char *password,int password_size,int has_password){
 cipher_key_clear();ERR_clear_error();struct key_password pass={password,password_size};
 EVP_PKEY *key=NULL;int is_private=private_key;
 if(!private_key)key=key_public(data,size,pem,type<0?1:type);
 if(!key){key=key_private(data,size,pem,type<0?0:type,has_password?&pass:NULL);is_private=1;}
 if(!key){ERR_clear_error();return 0;}
 if(is_private){PKCS8_PRIV_KEY_INFO *info=EVP_PKEY2PKCS8(key);if(info){key_der_size=i2d_PKCS8_PRIV_KEY_INFO(info,&key_der);PKCS8_PRIV_KEY_INFO_free(info);}}
 else key_der_size=i2d_PUBKEY(key,&key_der);
 EVP_PKEY_free(key);ERR_clear_error();
 if(key_der_size<=0){cipher_key_clear();return 0;}return is_private?2:1;
}
// Encoding follows ncrypto v1.1.4 writePrivateKey/writePublicKey.
// The input is a canonical, unencrypted PKCS8 or SPKI from the owned key.
API int cipher_key_export(const unsigned char *data,int size,int private_key,int pem,int type,const char *cipher,int has_cipher,const unsigned char *password,int password_size,int has_password,int ec_encoding){
 cipher_key_clear();ERR_clear_error();
 const EVP_CIPHER *algorithm=NULL;
 if(private_key && has_cipher){algorithm=EVP_get_cipherbyname(cipher);if(!algorithm)return -1;}
 const unsigned char *cursor=data;
 EVP_PKEY *key=private_key?key_private(data,size,0,0,NULL):d2i_PUBKEY(NULL,&cursor,size);
 if(!key){ERR_clear_error();return 0;}
 BIO *bio=BIO_new(BIO_s_mem());int ok=0;
 if(!bio){EVP_PKEY_free(key);return 0;}
 const char *pass=has_password?(const char*)password:NULL;
 if(private_key){
  if(type==0){
   ok=pem?PEM_write_bio_PKCS8PrivateKey(bio,key,algorithm,pass,password_size,NULL,NULL):i2d_PKCS8PrivateKey_bio(bio,key,algorithm,pass,password_size,NULL,NULL);
  }else if(type==1){
   RSA *rsa=EVP_PKEY_get0_RSA(key);
   if(rsa)ok=pem?PEM_write_bio_RSAPrivateKey(bio,rsa,algorithm,(const unsigned char*)pass,password_size,NULL,NULL):i2d_RSAPrivateKey_bio(bio,rsa);
  }else if(type==2){
   EC_KEY *ec=EVP_PKEY_get0_EC_KEY(key);
   if(ec){if(ec_encoding>=0)EC_KEY_set_enc_flags(ec,ec_encoding);ok=pem?PEM_write_bio_ECPrivateKey(bio,ec,algorithm,(const unsigned char*)pass,password_size,NULL,NULL):i2d_ECPrivateKey_bio(bio,ec);}
  }
 }else if(type==1){
  RSA *rsa=EVP_PKEY_get0_RSA(key);
  if(rsa)ok=pem?PEM_write_bio_RSAPublicKey(bio,rsa):i2d_RSAPublicKey_bio(bio,rsa);
 }else ok=pem?PEM_write_bio_PUBKEY(bio,key):i2d_PUBKEY_bio(bio,key);
 if(ok==1){
  const unsigned char *encoded;size_t length;
  if(BIO_mem_contents(bio,&encoded,&length) && length<=0x7fffffff){
   key_der=OPENSSL_malloc(length?length:1);
   if(key_der){if(length)memcpy(key_der,encoded,length);key_der_size=(int)length;}else ok=0;
  }else ok=0;
 }
 BIO_free(bio);EVP_PKEY_free(key);ERR_clear_error();
 if(ok!=1){cipher_key_clear();return 0;}return 1;
}
#define AEAD(name) if(!strcmp(algorithm,#name)) return EVP_aead_##name();
API const EVP_AEAD *cipher_aead(const char *algorithm) {
 AEAD(aes_128_gcm) AEAD(aes_192_gcm) AEAD(aes_256_gcm)
 AEAD(aes_128_eax) AEAD(aes_256_eax)
 AEAD(aes_128_ccm_matter) AEAD(aes_128_ccm_bluetooth) AEAD(aes_128_ccm_bluetooth_8)
 AEAD(aes_128_gcm_randnonce) AEAD(aes_256_gcm_randnonce)
 AEAD(aes_128_gcm_siv) AEAD(aes_256_gcm_siv)
 AEAD(aes_128_ctr_hmac_sha256) AEAD(aes_256_ctr_hmac_sha256)
 AEAD(xchacha20_poly1305) AEAD(chacha20_poly1305)
 return NULL;
}
API EVP_AEAD_CTX *cipher_aead_new(const EVP_AEAD *algorithm,const unsigned char *key,size_t size,size_t tag) {return EVP_AEAD_CTX_new(algorithm,key,size,tag);}
API void cipher_aead_free(EVP_AEAD_CTX *ctx) {EVP_AEAD_CTX_free(ctx);}
API int cipher_aead_seal(EVP_AEAD_CTX *ctx,unsigned char *out,unsigned char *tag,size_t *tag_size,size_t max_tag,const unsigned char *nonce,size_t nonce_size,const unsigned char *input,size_t size,const unsigned char *aad,size_t aad_size) {ERR_clear_error();return EVP_AEAD_CTX_seal_scatter(ctx,out,tag,tag_size,max_tag,nonce,nonce_size,input,size,NULL,0,aad,aad_size);}
API int cipher_aead_open(EVP_AEAD_CTX *ctx,unsigned char *out,const unsigned char *nonce,size_t nonce_size,const unsigned char *input,size_t size,const unsigned char *tag,size_t tag_size,const unsigned char *aad,size_t aad_size) {ERR_clear_error();return EVP_AEAD_CTX_open_gather(ctx,out,nonce,nonce_size,input,size,tag,tag_size,aad,aad_size);}
API int cipher_aead_info(const EVP_AEAD *a,int kind){return kind==0?EVP_AEAD_key_length(a):kind==1?EVP_AEAD_nonce_length(a):EVP_AEAD_max_overhead(a);}
API const EVP_CIPHER *cipher_lookup(const char *name){return EVP_get_cipherbyname(name);}
API EVP_CIPHER_CTX *cipher_new(void){return EVP_CIPHER_CTX_new();}
API void cipher_free(EVP_CIPHER_CTX *ctx){EVP_CIPHER_CTX_free(ctx);}
API int cipher_init(EVP_CIPHER_CTX *ctx,const EVP_CIPHER *cipher,const unsigned char *key,const unsigned char *iv,int encrypt){return EVP_CipherInit_ex(ctx,cipher,NULL,key,iv,encrypt);}
API int cipher_key_size(EVP_CIPHER_CTX *ctx,int size){return EVP_CIPHER_CTX_set_key_length(ctx,size);}
API int cipher_padding(EVP_CIPHER_CTX *ctx,int padding){return EVP_CIPHER_CTX_set_padding(ctx,padding);}
API int cipher_iv_size(EVP_CIPHER_CTX *ctx,int size){return EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_AEAD_SET_IVLEN,size,NULL);}
API int cipher_tag(EVP_CIPHER_CTX *ctx,int get,int size,unsigned char *data){return EVP_CIPHER_CTX_ctrl(ctx,get?EVP_CTRL_AEAD_GET_TAG:EVP_CTRL_AEAD_SET_TAG,size,data);}
API int cipher_update(EVP_CIPHER_CTX *ctx,unsigned char *out,int *size,const unsigned char *data,int length){return EVP_CipherUpdate(ctx,out,size,data,length);}
API int cipher_final(EVP_CIPHER_CTX *ctx,unsigned char *out,int *size){return EVP_CipherFinal_ex(ctx,out,size);}
API unsigned long cipher_error(void){return ERR_get_error();}
API const char *cipher_reason(unsigned long code){return ERR_reason_error_string(code);}
API int cipher_info(const EVP_CIPHER *cipher,int kind){return kind==0?EVP_CIPHER_key_length(cipher):kind==1?EVP_CIPHER_iv_length(cipher):kind==2?EVP_CIPHER_block_size(cipher):EVP_CIPHER_mode(cipher);}

API int cipher_bad_decrypt(void){uint32_t code=ERR_peek_last_error();int result=ERR_GET_LIB(code)==ERR_LIB_CIPHER && ERR_GET_REASON(code)==CIPHER_R_BAD_DECRYPT;ERR_clear_error();return result;}

API intptr_t cipher_curve_name(const char *name){
 int nid=EC_curve_nist2nid(name);if(nid==NID_undef)nid=OBJ_sn2nid(name);
 if(nid==NID_undef)return 0;EC_GROUP *group=EC_GROUP_new_by_curve_name(nid);if(!group)return -1;
 EC_GROUP_free(group);return (intptr_t)OBJ_nid2sn(nid);
}
API int cipher_ec_private_valid(const char *name,const unsigned char *data,int length){
 int nid=EC_curve_nist2nid(name);if(nid==NID_undef)nid=OBJ_sn2nid(name);
 EC_KEY *key=EC_KEY_new_by_curve_name(nid);BIGNUM *scalar=BN_bin2bn(data,length,NULL);
 int ok=key && scalar && EC_KEY_set_private_key(key,scalar);
 BN_clear_free(scalar);EC_KEY_free(key);ERR_clear_error();return ok;
}

API int cipher_dh_generate(const unsigned char *prime,int length,unsigned long generator,unsigned char *out){
 DH *dh=DH_new();BIGNUM *p=BN_bin2bn(prime,length,NULL),*g=BN_new();int ok=0;
 if(!dh || !p || !g || !BN_set_word(g,generator) || !DH_set0_pqg(dh,p,NULL,g))goto done;
 p=NULL;g=NULL;if(!DH_generate_key(dh))goto done;
 const BIGNUM *pub,*priv;DH_get0_key(dh,&pub,&priv);
 ok=BN_bn2bin_padded(out,length,pub) && BN_bn2bin_padded(out+length,length,priv);
 done: BN_free(p);BN_free(g);DH_free(dh);return ok;
}
API int cipher_dh_derive(const unsigned char *prime,int plen,const unsigned char *generator,int glen,const unsigned char *priv,int xlen,const unsigned char *pub,int ylen,unsigned char *out){
 DH *dh=DH_new();BIGNUM *p=BN_bin2bn(prime,plen,NULL),*g=BN_bin2bn(generator,glen,NULL),*x=BN_bin2bn(priv,xlen,NULL),*y=BN_bin2bn(pub,ylen,NULL);int result=-1;
 if(!dh || !p || !g || !x || !y || !DH_set0_pqg(dh,p,NULL,g))goto done;
 p=NULL;g=NULL;if(!DH_set0_key(dh,NULL,x))goto done;x=NULL;
 result=DH_compute_key_padded(out,y,dh);
 done: BN_free(p);BN_free(g);BN_clear_free(x);BN_free(y);DH_free(dh);return result;
}

API DH *dh_create(const unsigned char *prime,int plen,const unsigned char *generator,int glen){
 DH *dh=DH_new();BIGNUM *p=BN_bin2bn(prime,plen,NULL),*g=BN_bin2bn(generator,glen,NULL);
 if(!dh || !p || !g || !DH_set0_pqg(dh,p,NULL,g)){DH_free(dh);BN_free(p);BN_free(g);return NULL;}return dh;
}
API DH *dh_parameters(int bits,int generator){
 DH *dh=DH_new();if(!dh || !DH_generate_parameters_ex(dh,bits,generator,NULL)){DH_free(dh);return NULL;}return dh;
}
API DH *dh_group(int bits){
 BIGNUM *p=bits==2048?BN_get_rfc3526_prime_2048(NULL):bits==3072?BN_get_rfc3526_prime_3072(NULL):bits==4096?BN_get_rfc3526_prime_4096(NULL):bits==6144?BN_get_rfc3526_prime_6144(NULL):bits==8192?BN_get_rfc3526_prime_8192(NULL):NULL;
 BIGNUM *g=BN_new();DH *dh=DH_new();if(!p || !g || !dh || !BN_set_word(g,2) || !DH_set0_pqg(dh,p,NULL,g)){BN_free(p);BN_free(g);DH_free(dh);return NULL;}return dh;
}
API void dh_free(DH *dh){DH_free(dh);}
API int dh_check(DH *dh){int code=0;return DH_check(dh,&code)?code:-1;}
API int dh_generate(DH *dh){return DH_generate_key(dh);}
API int dh_get(DH *dh,int kind,unsigned char *out){
 const BIGNUM *bn=kind==0?DH_get0_p(dh):kind==1?DH_get0_g(dh):kind==2?DH_get0_pub_key(dh):DH_get0_priv_key(dh);
 if(!bn)return -1;int length=BN_num_bytes(bn);if(out && !BN_bn2bin_padded(out,length,bn))return -1;return length;
}
API int dh_set(DH *dh,int private_key,const unsigned char *key,int length){
 BIGNUM *bn=BN_bin2bn(key,length,NULL);if(!bn)return -1;
 if(!private_key){int code=0;if(!DH_check_pub_key(dh,bn,&code)){BN_free(bn);return -1;}if(code){BN_free(bn);return code;}}
 int ok=DH_set0_key(dh,private_key?NULL:bn,private_key?bn:NULL);if(!ok)BN_clear_free(bn);return ok?0:-1;
}
API int dh_peer_check(DH *dh,const unsigned char *key,int length){
 BIGNUM *bn=BN_bin2bn(key,length,NULL);int code=0;int ok=bn && DH_check_pub_key(dh,bn,&code);BN_free(bn);return ok?code:-1;
}
API int dh_compute(DH *dh,const unsigned char *key,int length,unsigned char *out){
 BIGNUM *bn=BN_bin2bn(key,length,NULL);if(!bn)return -1;int size=DH_compute_key_padded(out,bn,dh);BN_free(bn);return size;
}
API int dh_valid(DH *dh){return BN_is_odd(DH_get0_p(dh)) && BN_ucmp(DH_get0_g(dh),DH_get0_p(dh))<0;}

API int dh_group_check(DH *dh){return BN_mod_word(DH_get0_p(dh),24)==11?0:DH_NOT_SUITABLE_GENERATOR;}
