// OpenSSL bridge owned by cf-workers-native (MIT).
#include <emscripten/emscripten.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/ec.h>
#include <openssl/dh.h>
#include <openssl/ecdsa.h>
#include <openssl/err.h>
#include <openssl/provider.h>
#include <openssl/core_names.h>
#include <openssl/bn.h>
#include <stdlib.h>
#include <string.h>
#define API EMSCRIPTEN_KEEPALIVE
static unsigned char *output;
static size_t output_length;
static void clear_output(void) { OPENSSL_clear_free(output, output_length); output=NULL; output_length=0; }
static int save_bio(BIO *bio) {
  char *data; long size=BIO_get_mem_data(bio,&data);
  if(size<0) return 0;
  clear_output(); output=OPENSSL_memdup(data,(size_t)size);output_length=(size_t)size;
  return output != NULL;
}
API int wk_init(void) { return OPENSSL_init_crypto(OPENSSL_INIT_NO_LOAD_CONFIG,NULL); }
API void wk_output_clear(void) { clear_output(); }
API void *wk_output(void) { return output; }
API size_t wk_output_length(void) { return output_length; }
API unsigned long wk_error(void) { return ERR_get_error(); }
API const char *wk_error_reason(unsigned long error) { return ERR_reason_error_string(error); }
API int wk_equal(const void *a,const void *b,size_t size) { return CRYPTO_memcmp(a,b,size)==0; }
struct password_input {const unsigned char *bytes;int length;};
static int password_callback(char *buffer,int size,int writing,void *opaque) {
  (void)writing;struct password_input *password=opaque;
  if(!password || password->length>size)return -1;
  if(password->length)memcpy(buffer,password->bytes,password->length);
  return password->length;
}
API EVP_PKEY *wk_key_parse(const unsigned char *data,int size,int pem,int private_key,const unsigned char *password,int password_length) {
  ERR_clear_error(); BIO *bio=BIO_new_mem_buf(data,size); if(!bio)return NULL;
  struct password_input pass={password,password_length};
  EVP_PKEY *key=NULL;
  if(pem) {
    key=private_key?PEM_read_bio_PrivateKey(bio,NULL,password_callback,&pass):PEM_read_bio_PUBKEY(bio,NULL,NULL,NULL);
  } else {
    const unsigned char *cursor=data;
    key=private_key?d2i_AutoPrivateKey(NULL,&cursor,size):d2i_PUBKEY(NULL,&cursor,size);
    if(!key && private_key) { ERR_clear_error();BIO_reset(bio);key=d2i_PKCS8PrivateKey_bio(bio,NULL,password_callback,&pass); }
    if(!key && !private_key) { cursor=data; RSA *rsa=d2i_RSAPublicKey(NULL,&cursor,size);if(rsa){key=EVP_PKEY_new();if(!key || !EVP_PKEY_assign_RSA(key,rsa)){RSA_free(rsa);EVP_PKEY_free(key);key=NULL;}} }
  }
  BIO_free(bio);return key;
}
API void wk_key_free(EVP_PKEY *key) { EVP_PKEY_free(key); }
API const char *wk_key_type(EVP_PKEY *key) { return EVP_PKEY_get0_type_name(key); }
API int wk_key_bits(EVP_PKEY *key) { return EVP_PKEY_get_bits(key); }
API int wk_key_equal(EVP_PKEY *a,EVP_PKEY *b) { return EVP_PKEY_eq(a,b); }
API int wk_key_export(EVP_PKEY *key,int private_key,int pem,int type,const char *cipher_name,const char *password,int password_length,int ec_encoding) {
  ERR_clear_error();BIO *bio=BIO_new(BIO_s_mem());if(!bio)return 0;
  const EVP_CIPHER *cipher=cipher_name && *cipher_name?EVP_get_cipherbyname(cipher_name):NULL;
  if(cipher_name && *cipher_name && !cipher){BIO_free(bio);return 0;}
  int ok=0;
  if(private_key) {
    if(type==0) ok=pem?PEM_write_bio_PKCS8PrivateKey(bio,key,cipher,(char *)password,password_length,NULL,NULL):i2d_PKCS8PrivateKey_bio(bio,key,cipher,(char *)password,password_length,NULL,NULL);
    else if(type==1) {RSA *rsa=EVP_PKEY_get1_RSA(key);if(rsa){ok=pem?PEM_write_bio_RSAPrivateKey(bio,rsa,cipher,(const unsigned char *)password,password_length,NULL,NULL):i2d_RSAPrivateKey_bio(bio,rsa);RSA_free(rsa);}}
    else if(type==2) {EC_KEY *ec=EVP_PKEY_get1_EC_KEY(key);if(ec){if(ec_encoding>=0)EC_KEY_set_enc_flags(ec,ec_encoding);ok=pem?PEM_write_bio_ECPrivateKey(bio,ec,cipher,(const unsigned char *)password,password_length,NULL,NULL):i2d_ECPrivateKey_bio(bio,ec);EC_KEY_free(ec);}}
  } else {
    if(type==1) {RSA *rsa=EVP_PKEY_get1_RSA(key);if(rsa){ok=pem?PEM_write_bio_RSAPublicKey(bio,rsa):i2d_RSAPublicKey_bio(bio,rsa);RSA_free(rsa);}}
    else ok=pem?PEM_write_bio_PUBKEY(bio,key):i2d_PUBKEY_bio(bio,key);
  }
  if(ok)ok=save_bio(bio);BIO_free(bio);return ok;
}
API EVP_PKEY *wk_key_generate(const char *type,int bits,const char *curve,unsigned long exponent) {
  ERR_clear_error();EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new_from_name(NULL,type,NULL);if(!ctx)return NULL;
  EVP_PKEY *key=NULL;int ok=EVP_PKEY_keygen_init(ctx)>0;
  if(ok && (!strcmp(type,"RSA") || !strcmp(type,"RSA-PSS")))ok=EVP_PKEY_CTX_set_rsa_keygen_bits(ctx,bits)>0;
  if(ok && (!strcmp(type,"RSA") || !strcmp(type,"RSA-PSS"))) { BIGNUM *e=BN_new();ok=e && BN_set_word(e,exponent) && EVP_PKEY_CTX_set1_rsa_keygen_pubexp(ctx,e)>0;BN_free(e); }
  if(ok && (!strcmp(type,"EC") || !strcmp(type,"DH")))ok=EVP_PKEY_CTX_set_group_name(ctx,curve)>0;
  if(ok)ok=EVP_PKEY_generate(ctx,&key)>0;
  EVP_PKEY_CTX_free(ctx);if(!ok){EVP_PKEY_free(key);return NULL;}return key;
}
API EVP_PKEY *wk_key_generate_dh(const unsigned char *prime,int length,unsigned long generator,const unsigned char *components) {
 ERR_clear_error();BIGNUM *p=BN_bin2bn(prime,length,NULL),*g=BN_new(),*pub=BN_bin2bn(components,length,NULL),*priv=BN_bin2bn(components+length,length,NULL);
 DH *dh=DH_new();EVP_PKEY *key=NULL;
 if(!p || !g || !pub || !priv || !dh || !BN_set_word(g,generator) || !DH_set0_pqg(dh,p,NULL,g))goto done;
 p=NULL;g=NULL;if(!DH_set0_key(dh,pub,priv))goto done;pub=NULL;priv=NULL;
 key=EVP_PKEY_new();if(!key || !EVP_PKEY_assign_DH(key,dh)){EVP_PKEY_free(key);key=NULL;goto done;}dh=NULL;
 done: DH_free(dh);BN_free(p);BN_free(g);BN_free(pub);BN_clear_free(priv);return key;
}
static int signature_width(EVP_PKEY *key) {
  if(EVP_PKEY_is_a(key,"EC"))return (EVP_PKEY_get_bits(key)+7)/8;
  if(EVP_PKEY_is_a(key,"DSA")){BIGNUM *q=NULL;if(!EVP_PKEY_get_bn_param(key,OSSL_PKEY_PARAM_FFC_Q,&q))return 0;int size=BN_num_bytes(q);BN_free(q);return size;}
  return 0;
}
API int wk_sign(EVP_PKEY *key,const char *digest,const unsigned char *data,size_t length,int padding,int saltlen,int p1363) {
  ERR_clear_error();EVP_MD_CTX *ctx=EVP_MD_CTX_new();if(!ctx)return 0;EVP_PKEY_CTX *pctx=NULL;
  int ok=EVP_DigestSignInit_ex(ctx,&pctx,digest && *digest?digest:NULL,NULL,NULL,key,NULL)>0;
  if(ok && padding)ok=EVP_PKEY_CTX_set_rsa_padding(pctx,padding)>0;
  if(ok && padding==RSA_PKCS1_PSS_PADDING)ok=EVP_PKEY_CTX_set_rsa_pss_saltlen(pctx,saltlen)>0;
  size_t size=0;if(ok)ok=EVP_DigestSign(ctx,NULL,&size,data,length)>0;
  clear_output();if(ok){output=OPENSSL_malloc(size);output_length=size;ok=output && EVP_DigestSign(ctx,output,&output_length,data,length)>0;}
  if(ok && p1363 && signature_width(key)) {
    int width=signature_width(key);const unsigned char *cursor=output;ECDSA_SIG *signature=d2i_ECDSA_SIG(NULL,&cursor,output_length);
    unsigned char *raw=OPENSSL_malloc(2*width);const BIGNUM *r,*s;
    if(!signature || !raw)ok=0;
    else {ECDSA_SIG_get0(signature,&r,&s);ok=BN_bn2binpad(r,raw,width)==width && BN_bn2binpad(s,raw+width,width)==width;}
    ECDSA_SIG_free(signature);clear_output();if(ok){output=raw;output_length=2*width;}else OPENSSL_clear_free(raw,2*width);
  }
  EVP_MD_CTX_free(ctx);return ok;
}
API int wk_verify(EVP_PKEY *key,const char *digest,const unsigned char *data,size_t length,const unsigned char *signature,size_t signature_length,int padding,int saltlen,int p1363) {
  ERR_clear_error();EVP_MD_CTX *ctx=EVP_MD_CTX_new();if(!ctx)return -1;EVP_PKEY_CTX *pctx=NULL;
  int ok=EVP_DigestVerifyInit_ex(ctx,&pctx,digest && *digest?digest:NULL,NULL,NULL,key,NULL)>0;
  if(ok && padding)ok=EVP_PKEY_CTX_set_rsa_padding(pctx,padding)>0;
  if(ok && padding==RSA_PKCS1_PSS_PADDING)ok=EVP_PKEY_CTX_set_rsa_pss_saltlen(pctx,saltlen)>0;
  unsigned char *converted=NULL;
  if(ok && p1363 && signature_width(key)) {
    int width=signature_width(key);
    if(signature_length!=(size_t)(2*width)){EVP_MD_CTX_free(ctx);return 0;}
    ECDSA_SIG *value=ECDSA_SIG_new();BIGNUM *r=BN_bin2bn(signature,width,NULL),*s=BN_bin2bn(signature+width,width,NULL);
    if(!value || !r || !s || !ECDSA_SIG_set0(value,r,s)){ECDSA_SIG_free(value);BN_free(r);BN_free(s);EVP_MD_CTX_free(ctx);return -1;}
    int length=i2d_ECDSA_SIG(value,&converted);ECDSA_SIG_free(value);if(length<=0){EVP_MD_CTX_free(ctx);return -1;}
    signature=converted;signature_length=(size_t)length;
  }
  int result=ok?(EVP_DigestVerify(ctx,signature,signature_length,data,length)==1?1:0):-1;OPENSSL_free(converted);EVP_MD_CTX_free(ctx);return result;
}

API int wk_derive(EVP_PKEY *key,EVP_PKEY *peer) {
  ERR_clear_error();EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new(key,NULL);if(!ctx)return 0;
  size_t size=0;int ok=EVP_PKEY_derive_init(ctx)>0 && EVP_PKEY_derive_set_peer(ctx,peer)>0 && EVP_PKEY_derive(ctx,NULL,&size)>0;
  clear_output();if(ok){output=OPENSSL_malloc(size);output_length=size;ok=output && EVP_PKEY_derive(ctx,output,&output_length)>0;}
  EVP_PKEY_CTX_free(ctx);return ok;
}
API int wk_key_parameter(EVP_PKEY *key,const char *name) {
  ERR_clear_error();BIGNUM *bn=NULL;if(!EVP_PKEY_get_bn_param(key,name,&bn))return 0;
  clear_output();output_length=BN_num_bytes(bn);output=OPENSSL_malloc(output_length?output_length:1);
  int ok=output!=NULL;if(ok)BN_bn2bin(bn,output);BN_clear_free(bn);return ok;
}
API int wk_key_group(EVP_PKEY *key) {
  char name[100];size_t size=0;if(!EVP_PKEY_get_utf8_string_param(key,OSSL_PKEY_PARAM_GROUP_NAME,name,sizeof(name),&size))return 0;
  clear_output();output=(unsigned char *)OPENSSL_strdup(name);output_length=size;return output!=NULL;
}
API int wk_key_raw(EVP_PKEY *key,int private_key) {
  size_t size=0;int ok=private_key?EVP_PKEY_get_raw_private_key(key,NULL,&size):EVP_PKEY_get_raw_public_key(key,NULL,&size);
  clear_output();if(ok){output=OPENSSL_malloc(size);output_length=size;ok=output && (private_key?EVP_PKEY_get_raw_private_key(key,output,&output_length):EVP_PKEY_get_raw_public_key(key,output,&output_length));}return ok;
}
API int wk_prime_check(const unsigned char *data,int length,int checks) {
  ERR_clear_error();BIGNUM *value=BN_bin2bn(data,length,NULL);BN_CTX *ctx=BN_CTX_new();
  int result=value && ctx?BN_is_prime_ex(value,checks,ctx,NULL):-1;BN_clear_free(value);BN_CTX_free(ctx);return result;
}
API int wk_prime_generate(int bits,int safe,const unsigned char *add,int add_length,const unsigned char *rem,int rem_length) {
  ERR_clear_error();BIGNUM *a=add?BN_bin2bn(add,add_length,NULL):NULL,*r=rem?BN_bin2bn(rem,rem_length,NULL):NULL,*prime=BN_new();BN_CTX *ctx=BN_CTX_new();
  int ok=prime && ctx && (!add || a) && (!rem || r) && BN_generate_prime_ex2(prime,bits,safe,a,r,NULL,ctx);
  clear_output();if(ok){output_length=BN_num_bytes(prime);output=OPENSSL_malloc(output_length?output_length:1);ok=output!=NULL;if(ok)BN_bn2bin(prime,output);}
  BN_clear_free(a);BN_clear_free(r);BN_clear_free(prime);BN_CTX_free(ctx);return ok;
}
API EVP_MD_CTX *wk_digest_new(const char *algorithm) {
  ERR_clear_error();const EVP_MD *md=EVP_get_digestbyname(algorithm);
  if(md && EVP_MD_type(md)==NID_md4){static int legacy_initialized=0;if(!legacy_initialized){OSSL_PROVIDER_load(NULL,"default");OSSL_PROVIDER_load(NULL,"legacy");legacy_initialized=1;}}
  EVP_MD_CTX *ctx=EVP_MD_CTX_new();
  if(!md || !ctx || EVP_DigestInit_ex(ctx,md,NULL)!=1){EVP_MD_CTX_free(ctx);return NULL;}return ctx;
}
API EVP_MD_CTX *wk_digest_copy(EVP_MD_CTX *source) {EVP_MD_CTX *ctx=EVP_MD_CTX_new();if(!ctx || EVP_MD_CTX_copy_ex(ctx,source)!=1){EVP_MD_CTX_free(ctx);return NULL;}return ctx;}
API int wk_digest_size(EVP_MD_CTX *ctx) {return EVP_MD_CTX_get_size(ctx);}
API void wk_digest_free(EVP_MD_CTX *ctx) {EVP_MD_CTX_free(ctx);}
API int wk_digest_update(EVP_MD_CTX *ctx,const unsigned char *data,size_t length) {return EVP_DigestUpdate(ctx,data,length);}
API int wk_digest_final(EVP_MD_CTX *ctx) {
  unsigned int length=EVP_MAX_MD_SIZE;clear_output();output=OPENSSL_malloc(length);if(!output)return 0;
  output_length=length;if(EVP_DigestFinal_ex(ctx,output,&length)!=1){clear_output();return 0;}output_length=length;return 1;
}
API HMAC_CTX *wk_hmac_new(const char *algorithm,const unsigned char *key,int length) {
 EVP_MD_CTX *check=wk_digest_new(algorithm);if(!check)return NULL;EVP_MD_CTX_free(check);
 HMAC_CTX *ctx=HMAC_CTX_new();if(!ctx||HMAC_Init_ex(ctx,key,length,EVP_get_digestbyname(algorithm),NULL)!=1){HMAC_CTX_free(ctx);return NULL;}return ctx;
}
API void wk_hmac_free(HMAC_CTX *ctx){HMAC_CTX_free(ctx);}
API int wk_hmac_update(HMAC_CTX *ctx,const unsigned char *data,size_t length){return HMAC_Update(ctx,data,length);}
API int wk_hmac_final(HMAC_CTX *ctx){unsigned int length=EVP_MAX_MD_SIZE;clear_output();output=OPENSSL_malloc(length);if(!output)return 0;output_length=length;if(HMAC_Final(ctx,output,&length)!=1){clear_output();return 0;}output_length=length;return 1;}
API int wk_pbkdf2(const unsigned char *password,int password_length,const unsigned char *salt,int salt_length,int iterations,int length,const char *algorithm){
 EVP_MD_CTX *check=wk_digest_new(algorithm);if(!check)return 0;EVP_MD_CTX_free(check);
 clear_output();output=OPENSSL_malloc(length?length:1);if(!output)return 0;output_length=length;
 if(!PKCS5_PBKDF2_HMAC((const char*)password,password_length,salt,salt_length,iterations,EVP_get_digestbyname(algorithm),length,output)){clear_output();return 0;}return 1;
}
API int wk_sign_hash(EVP_PKEY *key,const char *digest,const unsigned char *data,size_t length,int padding,int saltlen) {
  ERR_clear_error();EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new(key,NULL);if(!ctx)return 0;
  int ok=EVP_PKEY_sign_init(ctx)>0 && EVP_PKEY_CTX_set_signature_md(ctx,EVP_get_digestbyname(digest))>0;
  if(ok && padding)ok=EVP_PKEY_CTX_set_rsa_padding(ctx,padding)>0;
  if(ok && padding==RSA_PKCS1_PSS_PADDING)ok=EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx,saltlen)>0;
  size_t size=0;if(ok)ok=EVP_PKEY_sign(ctx,NULL,&size,data,length)>0;
  clear_output();if(ok){output=OPENSSL_malloc(size);output_length=size;ok=output && EVP_PKEY_sign(ctx,output,&output_length,data,length)>0;}EVP_PKEY_CTX_free(ctx);return ok;
}
API int wk_verify_hash(EVP_PKEY *key,const char *digest,const unsigned char *data,size_t length,const unsigned char *signature,size_t signature_length,int padding,int saltlen) {
  ERR_clear_error();EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new(key,NULL);if(!ctx)return -1;
  int ok=EVP_PKEY_verify_init(ctx)>0 && EVP_PKEY_CTX_set_signature_md(ctx,EVP_get_digestbyname(digest))>0;
  if(ok && padding)ok=EVP_PKEY_CTX_set_rsa_padding(ctx,padding)>0;
  if(ok && padding==RSA_PKCS1_PSS_PADDING)ok=EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx,saltlen)>0;
  int result=ok?(EVP_PKEY_verify(ctx,signature,signature_length,data,length)==1?1:0):-1;EVP_PKEY_CTX_free(ctx);return result;
}
API EC_KEY *wk_ec_new(const char *curve) {return EC_KEY_new_by_curve_name(OBJ_sn2nid(curve));}
API void wk_ec_free(EC_KEY *key) {EC_KEY_free(key);}
API int wk_ec_generate(EC_KEY *key) {return EC_KEY_generate_key(key);}
API int wk_ec_set_private(EC_KEY *key,const unsigned char *data,int length) {
 const EC_GROUP *group=EC_KEY_get0_group(key);BIGNUM *private=BN_bin2bn(data,length,NULL),*order=BN_new();EC_POINT *point=EC_POINT_new(group);
 int ok=private && order && point && EC_GROUP_get_order(group,order,NULL) && !BN_is_zero(private) && BN_cmp(private,order)<0;
 if(ok)ok=EC_POINT_mul(group,point,private,NULL,NULL,NULL) && EC_KEY_set_private_key(key,private) && EC_KEY_set_public_key(key,point);
 BN_clear_free(private);BN_free(order);EC_POINT_free(point);return ok;
}
static int save_point(const EC_GROUP *group,const EC_POINT *point,int format) {
 clear_output();size_t size=EC_POINT_point2oct(group,point,format,NULL,0,NULL);if(!size)return 0;
 output=OPENSSL_malloc(size);output_length=size;return output && EC_POINT_point2oct(group,point,format,output,size,NULL)==size;
}
API int wk_ec_public(EC_KEY *key,int format) {const EC_POINT *point=EC_KEY_get0_public_key(key);return point && save_point(EC_KEY_get0_group(key),point,format);}
API int wk_ec_private(EC_KEY *key) {
 const BIGNUM *private=EC_KEY_get0_private_key(key);if(!private)return 0;clear_output();output_length=BN_num_bytes(private);output=OPENSSL_malloc(output_length);return output && BN_bn2bin(private,output)==output_length;
}
API int wk_ec_secret(EC_KEY *key,const unsigned char *data,size_t length) {
 if(EC_KEY_check_key(key)!=1)return -2;const EC_GROUP *group=EC_KEY_get0_group(key);EC_POINT *point=EC_POINT_new(group);
 if(!point || !EC_POINT_oct2point(group,point,data,length,NULL) || EC_POINT_is_at_infinity(group,point) || EC_POINT_is_on_curve(group,point,NULL)!=1){EC_POINT_free(point);return -3;}
 clear_output();output_length=(EC_GROUP_get_degree(group)+7)/8;output=OPENSSL_malloc(output_length);int ok=output && ECDH_compute_key(output,output_length,point,key,NULL)>0;EC_POINT_free(point);return ok;
}
API int wk_ec_convert(EC_KEY *key,const unsigned char *data,size_t length,int format) {
 const EC_GROUP *group=EC_KEY_get0_group(key);EC_POINT *point=EC_POINT_new(group);
 int ok=point && EC_POINT_oct2point(group,point,data,length,NULL) && save_point(group,point,format);EC_POINT_free(point);return ok;
}
API int wk_rsa(EVP_PKEY *key,int operation,const unsigned char *data,size_t length,int padding,const char *hash,const unsigned char *label,size_t label_length,int has_label) {
 ERR_clear_error();EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new(key,NULL);if(!ctx)return -1;
 int initialized=operation==0?EVP_PKEY_encrypt_init(ctx):operation==1?EVP_PKEY_decrypt_init(ctx):operation==2?EVP_PKEY_sign_init(ctx):EVP_PKEY_verify_recover_init(ctx);
 int status=-1;if(initialized<=0)goto done;
 const EVP_MD *digest=NULL;
 if(operation<2){digest=EVP_get_digestbyname(hash);if(!digest){status=-2;goto done;}}
 /* Match BoringSSL's accepted padding set and operation restrictions. */
 if((padding!=RSA_PKCS1_PADDING&&padding!=RSA_NO_PADDING&&padding!=RSA_PKCS1_OAEP_PADDING&&padding!=RSA_PKCS1_PSS_PADDING)||
    (padding==RSA_PKCS1_PSS_PADDING&&operation!=2)||
    (padding==RSA_PKCS1_OAEP_PADDING&&operation>=2)){status=-3;goto done;}
 if(EVP_PKEY_CTX_set_rsa_padding(ctx,padding)<=0){status=-3;goto done;}
 /* Workers rejects malformed PKCS#1 ciphertext rather than returning OpenSSL's
    implicit-rejection substitute plaintext. Keep successful decoding unchanged. */
 if(operation==1&&padding==RSA_PKCS1_PADDING&&EVP_PKEY_CTX_ctrl_str(ctx,"rsa_pkcs1_implicit_rejection","0")<=0){status=-3;goto done;}
 if(digest && padding==RSA_PKCS1_OAEP_PADDING){
  if(EVP_PKEY_CTX_set_rsa_oaep_md(ctx,digest)!=1){status=-4;goto done;}
  if(EVP_PKEY_CTX_set_rsa_mgf1_md(ctx,digest)!=1){status=-5;goto done;}
 }
 if(operation<2 && has_label){if(padding!=RSA_PKCS1_OAEP_PADDING){status=-6;goto done;}unsigned char *copy=OPENSSL_malloc(label_length?label_length:1);if(!copy){status=-6;goto done;}if(label_length)memcpy(copy,label,label_length);
  if(EVP_PKEY_CTX_set0_rsa_oaep_label(ctx,copy,label_length)!=1){OPENSSL_free(copy);status=-6;goto done;}
 }
 int (*cipher)(EVP_PKEY_CTX*,unsigned char*,size_t*,const unsigned char*,size_t)=operation==0?EVP_PKEY_encrypt:operation==1?EVP_PKEY_decrypt:operation==2?EVP_PKEY_sign:EVP_PKEY_verify_recover;
 size_t size=0;if(cipher(ctx,NULL,&size,data,length)!=1){status=-7;goto done;}
 clear_output();output=OPENSSL_malloc(size?size:1);output_length=size;
 if(!output || cipher(ctx,output,&output_length,data,length)!=1){clear_output();status=-8;goto done;}
 status=1;
 done: EVP_PKEY_CTX_free(ctx);return status;
}
API int wk_spkac(const unsigned char *data,int length,int operation) {
 while(length>0 && (data[length-1]==' ' || data[length-1]=='\n' || data[length-1]=='\r' || data[length-1]=='\t'))length--;
 if(!length)return 0;
 NETSCAPE_SPKI *spki=NETSCAPE_SPKI_b64_decode((const char*)data,length);if(!spki)return 0;
 int ok=0;EVP_PKEY *key=NULL;BIO *bio=NULL;
 if(operation==2){
  const ASN1_IA5STRING *challenge=spki->spkac->challenge;clear_output();output_length=ASN1_STRING_length(challenge);output=OPENSSL_malloc(output_length?output_length:1);
  if(output){memcpy(output,ASN1_STRING_get0_data(challenge),output_length);ok=1;}
 } else {
  key=NETSCAPE_SPKI_get_pubkey(spki);
  if(key && operation==1){bio=BIO_new(BIO_s_mem());ok=bio && PEM_write_bio_PUBKEY(bio,key) && save_bio(bio);}
  // Workers' FIPS backend rejects MD5 signatures. This is an API behavior
  // restriction, not a claim that the bundled OpenSSL build is FIPS certified.
  else if(key && OBJ_obj2nid(spki->sig_algor.algorithm)!=NID_md5WithRSAEncryption)ok=NETSCAPE_SPKI_verify(spki,key)==1;
 }
 BIO_free(bio);EVP_PKEY_free(key);NETSCAPE_SPKI_free(spki);return ok;
}

// Name rendering adapted from workerd crypto/x509.c++ (Apache-2.0).
#include <openssl/x509v3.h>
#include <stdint.h>
static const int kX509NameFlagsRFC2253WithinUtf8JSON = XN_FLAG_RFC2253 & ~ASN1_STRFLGS_ESC_MSB & ~ASN1_STRFLGS_ESC_CTRL;
int isSafeAltName(const char* name, size_t length, int utf8) {
  for (size_t i = 0; i < length; i++) {
    char c = name[i];
    switch (c) {
      case '"':
      case '\\':
        // These mess with encoding rules.
        // Fall through.
      case ',':
        // Commas make it impossible to split the list of subject alternative
        // names unambiguously, which is why we have to escape.
        // Fall through.
      case '\'':
        // Single quotes are unlikely to appear in any legitimate values, but they
        // could be used to make a value look like it was escaped (i.e., enclosed
        // in single/double quotes).
        return 0;
      default:
        if (utf8) {
          // In UTF8 strings, we require escaping for any ASCII control character,
          // but NOT for non-ASCII characters. Note that all bytes of any code
          // point that consists of more than a single byte have their MSB set.
          if (((unsigned char)c) < ' ' || c == '\x7f') {
            return 0;
          }
        } else {
          // Check if the char is a control character or non-ASCII character. Note
          // that char may or may not be a signed type. Regardless, non-ASCII
          // values will always be outside of this range.
          if (c < ' ' || c > '~') {
            return 0;
          }
        }
    }
  }
  return 1;
}

void printAltName(BIO* out, const char* name, size_t length, int utf8, const char* safe_prefix) {
  if (isSafeAltName(name, length, utf8)) {
    // For backward-compatibility, append "safe" names without any
    // modifications.
    if (safe_prefix != NULL) {
      BIO_printf(out, "%s:", safe_prefix);
    }
    BIO_write(out, name, length);
  } else {
    // If a name is not "safe", we cannot embed it without special
    // encoding. This does not usually happen, but we don't want to hide
    // it from the user either. We use JSON compatible escaping here.
    BIO_write(out, "\"", 1);
    if (safe_prefix != NULL) {
      BIO_printf(out, "%s:", safe_prefix);
    }
    for (size_t j = 0; j < length; j++) {
      char c = name[j];
      if (c == '\\') {
        BIO_write(out, "\\\\", 2);
      } else if (c == '"') {
        BIO_write(out, "\\\"", 2);
      } else if ((c >= ' ' && c != ',' && c <= '~') || (utf8 && (c & 0x80))) {
        // Note that the above condition explicitly excludes commas, which means
        // that those are encoded as Unicode escape sequences in the "else"
        // block. That is not strictly necessary, and Node.js itself would parse
        // it correctly either way. We only do this to account for third-party
        // code that might be splitting the string at commas (as Node.js itself
        // used to do).
        BIO_write(out, &c, 1);
      } else {
        // Control character or non-ASCII character. We treat everything as
        // Latin-1, which corresponds to the first 255 Unicode code points.
        const char hex[] = "0123456789abcdef";
        char u[] = {'\\', 'u', '0', '0', hex[(c & 0xf0) >> 4], hex[c & 0x0f]};
        BIO_write(out, u, sizeof(u));
      }
    }
    BIO_write(out, "\"", 1);
  }
}

void printLatin1AltName(BIO* out, const ASN1_IA5STRING* name, const char* safe_prefix) {
  printAltName(out, (const char*)name->data, name->length, 0, safe_prefix);
}

void printUtf8AltName(BIO* out, const ASN1_UTF8STRING* name, const char* safe_prefix) {
  printAltName(out, (const char*)name->data, name->length, 1, safe_prefix);
}

int printGeneralName(BIO* out, const GENERAL_NAME* gen) {
  if (gen->type == GEN_DNS) {
    ASN1_IA5STRING* name = gen->d.dNSName;
    BIO_write(out, "DNS:", 4);
    // Note that the preferred name syntax (see RFCs 5280 and 1034) with
    // wildcards is a subset of what we consider "safe", so spec-compliant DNS
    // names will never need to be escaped.
    printLatin1AltName(out, name, NULL);
  } else if (gen->type == GEN_EMAIL) {
    ASN1_IA5STRING* name = gen->d.rfc822Name;
    BIO_write(out, "email:", 6);
    printLatin1AltName(out, name, NULL);
  } else if (gen->type == GEN_URI) {
    ASN1_IA5STRING* name = gen->d.uniformResourceIdentifier;
    BIO_write(out, "URI:", 4);
    // The set of "safe" names was designed to include just about any URI,
    // with a few exceptions, most notably URIs that contains commas (see
    // RFC 2396). In other words, most legitimate URIs will not require
    // escaping.
    printLatin1AltName(out, name, NULL);
  } else if (gen->type == GEN_DIRNAME) {
    // Earlier versions of Node.js used X509_NAME_oneline to print the X509_NAME
    // object. The format was non standard and should be avoided. The use of
    // X509_NAME_oneline is discouraged by OpenSSL but was required for backward
    // compatibility. Conveniently, X509_NAME_oneline produced ASCII and the
    // output was unlikely to contains commas or other characters that would
    // require escaping. However, it SHOULD NOT produce ASCII output since an
    // RFC5280 AttributeValue may be a UTF8String.
    // Newer versions of Node.js have since switched to X509_NAME_print_ex to
    // produce a better format at the cost of backward compatibility. The new
    // format may contain Unicode characters and it is likely to contain commas,
    // which require escaping. Fortunately, the recently safeguarded function
    // PrintAltName handles all of that safely.
    BIO_printf(out, "DirName:");
    BIO *tmp = BIO_new(BIO_s_mem()); if (!tmp) return 0;
    if (X509_NAME_print_ex(tmp, gen->d.dirn, 0, kX509NameFlagsRFC2253WithinUtf8JSON) < 0) {
      BIO_free(tmp); return 0;
    }
    char* oline = NULL;
    long n_bytes = BIO_get_mem_data(tmp, &oline);  // NOLINT(runtime/int)

    if (n_bytes < 0 || (n_bytes > 0 && oline == NULL)) { BIO_free(tmp); return 0; }

    printAltName(out, oline, (size_t)n_bytes, 1, NULL); BIO_free(tmp);
  } else if (gen->type == GEN_IPADD) {
    BIO_printf(out, "IP Address:");
    const ASN1_OCTET_STRING* ip = gen->d.ip;
    const unsigned char* b = ip->data;
    if (ip->length == 4) {
      BIO_printf(out, "%d.%d.%d.%d", b[0], b[1], b[2], b[3]);
    } else if (ip->length == 16) {
      for (unsigned int j = 0; j < 8; j++) {
        uint16_t pair = (b[2 * j] << 8) | b[2 * j + 1];
        BIO_printf(out, (j == 0) ? "%X" : ":%X", pair);
      }
    } else {
      BIO_printf(out, "<invalid>");
    }
  } else if (gen->type == GEN_RID) {
    // Unlike OpenSSL's default implementation, never print the OID as text and
    // instead always print its numeric representation.
    char oline[256] = {0};
    OBJ_obj2txt(oline, sizeof(oline), gen->d.rid, 1);
    BIO_printf(out, "Registered ID:%s", oline);
  } else if (gen->type == GEN_OTHERNAME) {
    // The pinned Workers BoringSSL build uses the pre-OpenSSL-3 rendering.
    BIO_printf(out, "othername:<unsupported>");
  } else if (gen->type == GEN_X400) {
    // TODO(tniessen): this is what OpenSSL does, implement properly instead
    BIO_printf(out, "X400Name:<unsupported>");
  } else if (gen->type == GEN_EDIPARTY) {
    // TODO(tniessen): this is what OpenSSL does, implement properly instead
    BIO_printf(out, "EdiPartyName:<unsupported>");
  } else {
    // This is safe because X509V3_EXT_d2i would have returned NULL in this
    // case already.
    return 0;
  }

  return 1;
}

int safeX509SubjectAltNamePrint(BIO* out, X509_EXTENSION* ext) {


  GENERAL_NAMES* names = (GENERAL_NAMES*)X509V3_EXT_d2i(ext);
  if (names == NULL) return 0;

  int ok = 1;

  for (int i = 0; i < sk_GENERAL_NAME_num(names); i++) {
    GENERAL_NAME* gen = sk_GENERAL_NAME_value(names, i);

    if (i != 0) BIO_write(out, ", ", 2);

    if (!(ok = printGeneralName(out, gen))) {
      break;
    }
  }
  sk_GENERAL_NAME_pop_free(names, GENERAL_NAME_free);

  return ok;
}

int safeX509InfoAccessPrint(BIO* out, X509_EXTENSION* ext) {


  AUTHORITY_INFO_ACCESS* descs = (AUTHORITY_INFO_ACCESS*)X509V3_EXT_d2i(ext);
  if (descs == NULL) return 0;

  int ok = 1;

  for (int i = 0; i < sk_ACCESS_DESCRIPTION_num(descs); i++) {
    ACCESS_DESCRIPTION* desc = sk_ACCESS_DESCRIPTION_value(descs, i);

    if (i != 0) BIO_write(out, "\n", 1);

    char objtmp[80] = {0};
    i2t_ASN1_OBJECT(objtmp, sizeof(objtmp), desc->method);
    BIO_printf(out, "%s - ", objtmp);
    if (!(ok = printGeneralName(out, desc->location))) {
      break;
    }
  }
  sk_ACCESS_DESCRIPTION_pop_free(descs, ACCESS_DESCRIPTION_free);

  // BoringSSL follows the pre-OpenSSL-3 infoAccess representation.
  BIO_write(out, "\n", 1);

  return ok;
}


API X509 *wk_x509_parse(const unsigned char *data, int length) {
  ERR_clear_error(); BIO *bio=BIO_new_mem_buf(data,length); if(!bio)return NULL;
  X509 *cert=PEM_read_bio_X509_AUX(bio,NULL,NULL,NULL); BIO_free(bio);
  if(!cert){ERR_clear_error();const unsigned char *p=data;cert=d2i_X509(NULL,&p,length);}
  ERR_clear_error();return cert;
}
API void wk_x509_free(X509 *cert) {X509_free(cert);}
API EVP_PKEY *wk_x509_key(X509 *cert) {return X509_get_pubkey(cert);}
API int wk_x509_ca(X509 *cert) {return X509_check_ca(cert)==1;}
API int wk_x509_compare(X509 *cert,void *other,int operation) {
  ERR_clear_error(); int ok=operation==0?X509_check_issued(other,cert)==X509_V_OK:operation==1?X509_check_private_key(cert,other)==1:X509_verify(cert,other)==1;
  ERR_clear_error();return ok;
}
API int wk_x509_check(X509 *cert,const char *name,int length,int flags,int operation) {
  char *peer=NULL;ERR_clear_error();clear_output();
  int ok=operation==0?X509_check_host(cert,name,length,flags,&peer):operation==1?X509_check_email(cert,name,length,flags):X509_check_ip_asc(cert,name,flags);
  if(ok==1){output_length=peer?strlen(peer):(size_t)length;output=OPENSSL_memdup(peer?peer:name,output_length);if(!output)ok=-1;}
  OPENSSL_free(peer);ERR_clear_error();return ok;
}
static void x509_name_part(BIO *bio,const void *data,int length) {
  unsigned char size[4]={(unsigned int)length>>24,(unsigned int)length>>16,(unsigned int)length>>8,(unsigned int)length};
  BIO_write(bio,size,4);BIO_write(bio,data,length);
}
API int wk_x509_field(X509 *cert,int field) {
  ERR_clear_error();clear_output(); BIO *bio=BIO_new(BIO_s_mem());if(!bio)return 0;int ok=1;
  switch(field) {
    case 0: case 1: ok=X509_NAME_print_ex(bio,field==0?X509_get_subject_name(cert):X509_get_issuer_name(cert),0,ASN1_STRFLGS_ESC_2253|ASN1_STRFLGS_ESC_CTRL|ASN1_STRFLGS_UTF8_CONVERT|XN_FLAG_SEP_MULTILINE|XN_FLAG_FN_SN)>0;break;
    case 2: case 3: {int index=X509_get_ext_by_NID(cert,field==2?NID_subject_alt_name:NID_info_access,-1);ok=index>=0;if(ok)ok=field==2?safeX509SubjectAltNamePrint(bio,X509_get_ext(cert,index)):safeX509InfoAccessPrint(bio,X509_get_ext(cert,index));break;}
    case 4: case 5: ok=ASN1_TIME_print(bio,field==4?X509_get0_notBefore(cert):X509_get0_notAfter(cert));break;
    case 6: case 7: case 8: {unsigned char digest[EVP_MAX_MD_SIZE];unsigned int size=0;ok=X509_digest(cert,field==6?EVP_sha1():field==7?EVP_sha256():EVP_sha512(),digest,&size);if(ok)for(unsigned int i=0;i<size;i++)BIO_printf(bio,i?":%02X":"%02X",digest[i]);break;}
    case 9: {BIGNUM *bn=ASN1_INTEGER_to_BN(X509_get_serialNumber(cert),NULL);char *hex=bn?BN_bn2hex(bn):NULL;ok=hex!=NULL;if(ok)BIO_puts(bio,hex);OPENSSL_free(hex);BN_free(bn);break;}
    case 10: ok=i2d_X509_bio(bio,cert);break;
    case 11: ok=PEM_write_bio_X509(bio,cert);break;
    case 12: {EXTENDED_KEY_USAGE *eku=X509_get_ext_d2i(cert,NID_ext_key_usage,NULL,NULL);ok=eku!=NULL;if(ok){for(int i=0;i<sk_ASN1_OBJECT_num(eku);i++){char oid[256];OBJ_obj2txt(oid,sizeof(oid),sk_ASN1_OBJECT_value(eku,i),1);if(i)BIO_puts(bio,"\n");BIO_puts(bio,oid);}EXTENDED_KEY_USAGE_free(eku);}break;}
    case 13: case 14: {X509_NAME *name=field==13?X509_get_subject_name(cert):X509_get_issuer_name(cert);for(int i=0;i<X509_NAME_entry_count(name);i++){X509_NAME_ENTRY *entry=X509_NAME_get_entry(name,i);ASN1_OBJECT *obj=X509_NAME_ENTRY_get_object(entry);char oid[256];const char *key=OBJ_nid2sn(OBJ_obj2nid(obj));if(!key){OBJ_obj2txt(oid,sizeof(oid),obj,1);key=oid;}unsigned char *value=NULL;int length=ASN1_STRING_to_UTF8(&value,X509_NAME_ENTRY_get_data(entry));if(length<0){ok=0;break;}x509_name_part(bio,key,(int)strlen(key));x509_name_part(bio,value,length);OPENSSL_free(value);}break;}
    case 15: case 16: {EVP_PKEY *key=X509_get_pubkey(cert);EC_KEY *ec=key?EVP_PKEY_get1_EC_KEY(key):NULL;ok=ec!=NULL;if(ok){int nid=EC_GROUP_get_curve_name(EC_KEY_get0_group(ec));const char *name=field==15?OBJ_nid2sn(nid):EC_curve_nid2nist(nid);ok=name!=NULL;if(ok)BIO_puts(bio,name);}EC_KEY_free(ec);EVP_PKEY_free(key);break;}
    case 17: {EVP_PKEY *key=X509_get_pubkey(cert);EC_KEY *ec=key?EVP_PKEY_get1_EC_KEY(key):NULL;unsigned char *data=NULL;int length=ec?i2o_ECPublicKey(ec,&data):0;ok=length>0;if(ok)BIO_write(bio,data,length);OPENSSL_free(data);EC_KEY_free(ec);EVP_PKEY_free(key);break;}
    default:ok=0;
  }
  if(ok)ok=save_bio(bio);BIO_free(bio);ERR_clear_error();return ok;
}

// Memory-BIO TLS for platforms whose connected transport cannot add TLS.
// The host MUST authenticate the peer chain and hostname before exposing data.
#include <openssl/ssl.h>
API SSL *wk_tls_new(const char *host) {
  ERR_clear_error(); SSL_CTX *ctx=SSL_CTX_new(TLS_client_method());if(!ctx)return NULL;
  SSL_CTX_set_min_proto_version(ctx,TLS1_2_VERSION);
  // Trust is evaluated by the OS (SecTrust), not a separate bundled CA store.
  SSL_CTX_set_verify(ctx,SSL_VERIFY_NONE,NULL);
  SSL *ssl=SSL_new(ctx);SSL_CTX_free(ctx);if(!ssl)return NULL;
  BIO *read=BIO_new(BIO_s_mem()),*write=BIO_new(BIO_s_mem());
  if(!read || !write){BIO_free(read);BIO_free(write);SSL_free(ssl);return NULL;}
  BIO_set_mem_eof_return(read,-1);BIO_set_mem_eof_return(write,-1);
  SSL_set_bio(ssl,read,write);SSL_set_connect_state(ssl);
  SSL_set_mode(ssl,SSL_MODE_ENABLE_PARTIAL_WRITE|SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
  if(host && *host && !SSL_set_tlsext_host_name(ssl,host)){SSL_free(ssl);return NULL;}
  return ssl;
}
API void wk_tls_free(SSL *ssl){SSL_free(ssl);}
API int wk_tls_feed(SSL *ssl,const unsigned char *data,int length){return BIO_write(SSL_get_rbio(ssl),data,length)==length;}
API int wk_tls_handshake(SSL *ssl){ERR_clear_error();int r=SSL_do_handshake(ssl);return r==1?1:-SSL_get_error(ssl,r);}
API int wk_tls_read(SSL *ssl){
  ERR_clear_error();clear_output();output_length=65536;output=OPENSSL_malloc(output_length);if(!output)return -1;
  int r=SSL_read(ssl,output,output_length);if(r>0){output_length=r;return r;}int error=SSL_get_error(ssl,r);clear_output();return -error;
}
API int wk_tls_write(SSL *ssl,const unsigned char *data,int length){ERR_clear_error();int r=SSL_write(ssl,data,length);return r>0?r:-SSL_get_error(ssl,r);}
API int wk_tls_drain(SSL *ssl){
  clear_output();size_t size=BIO_ctrl_pending(SSL_get_wbio(ssl));if(!size)return 0;if(size>65536)size=65536;
  output=OPENSSL_malloc(size);output_length=size;if(!output)return -1;
  int r=BIO_read(SSL_get_wbio(ssl),output,size);if(r>0){output_length=r;return r;}clear_output();return -1;
}
API int wk_tls_shutdown(SSL *ssl){ERR_clear_error();int r=SSL_shutdown(ssl);return r>=0?r:-SSL_get_error(ssl,r);}
API int wk_tls_certificate(SSL *ssl,int index){
  STACK_OF(X509) *chain=SSL_get_peer_cert_chain(ssl);if(!chain || index<0 || index>=sk_X509_num(chain))return 0;
  BIO *bio=BIO_new(BIO_s_mem());if(!bio)return 0;int ok=i2d_X509_bio(bio,sk_X509_value(chain,index));if(ok)ok=save_bio(bio);BIO_free(bio);return ok;
}
