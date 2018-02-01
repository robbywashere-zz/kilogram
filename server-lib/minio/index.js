const Minio = require('minio');
const path = require('path');
const s2p = require('stream-to-promise');
const Uuid = require('uuid');
const { logger } = require('../../lib/logger');
const config = require('config');
const get = require('lodash/get');
const Promise = require('bluebird');
const { Photo } = require('../../objects');
const { chunk } = require('lodash');
const minioObj = require('./minioObject');
const demand = require('../../lib/demand');

const { removeObject,
  listObjects,
  signedURL } = require('./middlewares');


const ClientConfig =  {
  endPoint: config.get('MINIO_ENDPOINT'),
  bucket: config.get('MINIO_BUCKET'),
  port: parseInt(config.get('MINIO_PORT')),
  secure: (config.get('MINIO_SECURE') !== "true") ? false : true,
  accessKey: config.get('S3_ACCESS_KEY'),
  secretKey: config.get('S3_SECRET_KEY'),
  tmpDir: config.get('MINIO_TMP_DIR'),
}


function WrapMinioClient(client = demand('client instance/client.prototype'), opts = {}){
  const wrapMethods = `makeBucket
  listBuckets
  bucketExists
  removeBucket
  listObjects
  listObjectsV2
  listIncompleteUploads
  fPutObject
  fGetObject
  getObject
  putObject
  copyObject
  statObject
  removeObject
  removeIncompleteUpload
  presignedGetObject
  presignedPostPolicy
  getBucketNotification
  setBucketNotification
  presignedPutObject
  removeAllBucketNotification
  getBucketPolicy
  setBucketPolicy`.split("\n").map(x=>x.trim());

  wrapMethods.forEach(m=>{
    const wfn = client[m];
    if (typeof wfn !== "undefined") {
      client[m] = (...args) => retryConnRefused3({ ...opts, fn: async ()=>wfn.bind(client)(...args), debug: `Function: ${m}` });
    }
  })
  return client;

}

//TODO: return this to above list 
//

class MClient {
  constructor({ bucket = ClientConfig.bucket, region='us-east-1', config = ClientConfig, client }={}){
    this.config = config;
    this.bucket = bucket;
    this.region = region;
    this.client = (client) ? client : WrapMinioClient(new Minio.Client(config));
  }


  listen({ bucket = this.bucket, client = this.client, events }){
    const listener = client.listenBucketNotification(bucket, '', '', ['s3:ObjectCreated:*','s3:ObjectRemoved:*']);
    logger.debug('Listening for s3/minio events ....');
    listener.on('notification', events);
    return listener;
  }

  getSignedPutObject({ name, exp = 60}) { 
    return this.client.presignedPutObject(this.bucket, name, exp)
  }

  async pullPhoto({ bucket = this.bucket, name, tmpDir = this.config.tmpDir }){
    try {
      const localpath = path.join(tmpDir,name)
      await this.client.fGetObject(bucket,name,localpath)
      return localpath;
    } catch(e) {
      throw e
    }
  }

  signedURL({ bucket= this.bucket }){
    return signedURL({ bucket, client: this.client })
  }

  removeObject({ bucket = this.bucket, name }){

    return this.client.removeObject(bucket, name)
  }
  async listObjectsWithSURLs(){
    const objects = await s2p(this.client.listObjects(this.bucket));
    objects.forEach(o=>o.bucketName=this.bucket);
    for (let o of chunk(objects, 20)) { //<--- Fanout
      await Promise.all(o
        .map(obj => this.client
          .presignedGetObject(this.bucket, obj.name, 30)
          .then(u=>obj.url = u)));
    }
    return objects;
  }

  async newPhoto({ bucket = this.bucket, accountId = demand('accountId') }){
    const uuid = Uuid.v4();
    const name = minioObj.create('v4',{ uuid, accountId })
    const url = await this.getSignedPutObject({ name }); //TODO: 
    return { url, uuid, objectName: name };
  }

  init(){
    return this.createBucket().then( ()=> this.listen({ events: MClient.PhotoEvents() }))
  }

  async createBucket({ bucket = this.bucket, region = this.region } = {}){
    try {
      await this.client.bucketExists(bucket)
    } catch(err) {
      if (err.code === 'NoSuchBucket') {
        try {
          await this.client.makeBucket(bucket, this.region)
          return logger(`Bucket ${bucket} created successfully in ${this.region}.`)
        } catch(err) {
          if (err) logger.error(err)
        }
      } 
    }
    logger.debug(`Bucket ${bucket} exists ... skipping`)
  }

  static PhotoEvents(){
    return MClient.Event({
      putFn: MClient.PutPhotoFn,
      delFn: MClient.DelPhotoFn
    })
  }

  static PutPhotoFn({ bucket, key }){
    const { uuid, accountId } = minioObj.parse(key);
    return Photo.create({bucket, objectName: key, uuid, AccountId });
  }
  static DelPhotoFn({ key }){
    return Photo.setDeleted(key);
  }
  static Event({ putFn,delFn }) {
    return async (record) => {
      const key = get(record,'s3.object.key'); 
      const bucket = get(record,'s3.bucket.name'); 
      const event =  get(record,'eventName'); 

      logger.debug('Caught event: ', key, event);
      try {
        logger.debug('  event meta data',JSON.stringify(minioObj.parse(key)))
      } catch(e) {
        //swallow
      }
      if (key) {
        try {
          if (event === "s3:ObjectCreated:Put") {
            await putFn({ bucket, record, key })
          } else if (event === "s3:ObjectRemoved:Deleted") {
            await delFn({ key })
          }
        } catch(e) {
          logger.error(e)
        }
      }
    }
  }
}

async function retryConnRefused4({ fn,  retryDelayFn = ()=>3000, debug = '' }) {
  try {
    return await fn();
  } catch(err) {
    if (err.code === 'ECONNREFUSED') {
      logger.debug(`Error: Connection refused, retrying ...  - ${debug}`)
      await Promise.delay(retryDelayFn());
      return await retryConnRefused4({ fn, retryDelayFn, debug });
    }
    throw err;
  }
}

async function retryConnRefused3({ fn, retryCount = 1, retryDelayFn = (retries)=>retries*3000, max = 5, debug = '' }) {
  try {
    return await fn();
  } catch(err) {
    if (err.code === 'ECONNREFUSED' && retryCount <= max) {
      logger.debug(`Error: Connection refused, retrying ${retryCount}/${max} - ${debug}`)
      await Promise.delay(retryDelayFn(retryCount));
      return await retryConnRefused3({ fn, retryCount: retryCount+1, max, retryDelayFn, debug });
    }
    throw err;
  }
}

async function retryConnRefused2({ fn, retryCount = 1, max = 5, ms = 3000 }) {
  try {
    return await fn();
  } catch(err) {
    if (err.code === 'ECONNREFUSED' && retryCount <= max) {
      await Promise.delay(retryCount*ms);
      return retryConnRefused2({ fn, retryCount: retryCount+1, max, ms });
    }
    throw err;
  }
}

async function retryConnRefused(fn, retryCount = 1) {
  try {
    return await fn();
  } catch(err) {
    if (err.code === 'ECONNREFUSED') {
      if (retryCount <= 5) {
        logger(`Could not connect to MINIO storage\n* Trying again in ${retryCount*3} seconds .... Retry #:${retryCount}`) 
        await Promise.delay(retryCount*3*1000);
        return retryConnRefused(fn, retryCount+1);
      }
      else {
        throw new Error(`Could not connect to MINIO storage\n* Confirm minio is installed and running.\nTry: $>npm run minio:up \n* refer to README.md for help`)
      }
    } else {
      throw err;
    }
  }


}



module.exports = { WrapMinioClient, signedURL, removeObject, retryConnRefused, MClient, ClientConfig, listObjects };

/*
{ Error: connect ECONNREFUSED 127.0.0.1:9000
    at Object._errnoException (util.js:1019:11)
    at _exceptionWithHostPort (util.js:1041:20)
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1175:14)
  code: 'ECONNREFUSED',
  errno: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 9000 }
  */
