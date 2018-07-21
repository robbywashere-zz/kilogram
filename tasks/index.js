const demand = require('../lib/demand');
const demandKeys = require('../lib/demandKeys');
const minio = require('../server-lib/minio');
const { get, chain, isUndefined } = require('lodash');
const { logger } = require('../lib/logger');
const requestAsync = require('request-promise');
const request = require('request');
const Emailer = require('../server-lib/emailer');
const { Photo, DownloadIGAva, Device } = require('../objects');
const DeviceAgent = require('../android/deviceAgent');

async function downloadIGAva({
  events = demand('events'),
  minioClient = demand('minioClient'),
  IGAccount = demand('IGAccount'),
  jobId = demand('jobId'),
  jobName = demand('jobName'),
  reqAsync = requestAsync,
  reqPipe = request,
}) {
  const body = {};

  try {
    const html = await reqAsync.get(`https://www.instagram.com/${IGAccount.username}`);

    body.avatar = html.match(/"og:image".+?content="(.+)"/)[1];

    if (!body.avatar) {
      body.html = html;
      throw new Error('could not locate IG Avatar in body html');
    }

    const { url, objectName, uuid } = await minioClient.newPhoto({
      AccountId: IGAccount.AccountId,
      IGAccountId: IGAccount.id,
      type: 'IGAVATAR',
    });

    body.uuid = uuid;

    body.minioUrl = url;

    await new Promise((rs, rx) => reqPipe.get(body.avatar).pipe(reqPipe.put(url)).on('finish', rs).on('error', rx));

    events.emit('IGAccount:downloadIGAva', { id: IGAccount.id, uuid, jobId, jobName });
    events.emit('job:complete',{ jobId, jobName })
  } catch (error) {
    try { await Photo.destroy({ where: { uuid: body.uuid }}) } catch(e){ /* :shrug: */};
    events.emit('job:error', { error, body, jobId, jobName });
  }

}

async function sendEmail({
  events = demand('events'),
  jobId = demand('jobId'),
  jobName = demand('jobName'),
  reqAsync = requestAsync,
  reqPipe = request,
  email: {
    to, from, msg: message, subject, //demand?
  },
}) {
  try {

    const emailer = new Emailer({ });
    await emailer.send({
      to, from, msg: message, subject,
    });
    events.emit('job:complete',{ jobId, jobName })
  } catch (error) {
    events.emit('job:error',{ jobId, jobName, error, body: {} })
  }
}


async function verifyIG({ // emit
  events = demand('events'),
  jobId = demand('jobId'),
  jobName = demand('jobName'),
  agent = demand('agent'),
  IGAccount = demand('IGAccount'),
}) {
  let body = {};
  try {

    const agentResult = await agent.exec({
      cmd: 'verify_ig_dance',
      args: {
        username: IGAccount.username,
        password: IGAccount.password,
      },
    });

    body = get(agentResult, 'body', {});

    if (body.login === true) {
      events.emit('IGAccount:good', { jobId, jobName, id: IGAccount.id });
    }
    if (body.login === false && body.type === 'creds_error') {
      events.emit('IGAccount:fail', { jobId, jobName, IGAccountId: IGAccount.id });
    }
    events.emit('job:complete',{ jobId, jobName })
  } catch (error) {
    events.emit('job:error', { error, body, jobId, jobName });
  }
}

async function post({
  minioClient = demand('minioClient'),
  events = demand('events'),
  jobId = demand('jobId'),
  jobName = demand('jobName'),
  agent = demand('agent'),
  IGAccount = demand('IGAccount'),
  Post = demand('Post'),
}) {
  let agentResult = {};
  let body = {};

  try {

    //agent
    const localfile = await minioClient.pullPhoto({ name: Post.Photo.objectName });
    agentResult = await agent.exec({
      cmd: 'full_dance',
      args: {
        username: IGAccount.username,
        password: IGAccount.password,
        desc: Post.text,
        localfile, // TODO: DELETE WHEN FIN
      },
    });
    //end

    body = get(agentResult, 'body', {});

    if (agentResult.success) {
      events.emit('Post:published', { id: Post.id, jobId, jobName });
    }

    if (get(agentResult, 'body.type') === 'creds_error') { 
      events.emit('IGAccount:fail', { id: IGAccount.id, jobId, jobName, body });
    }
    events.emit('job:complete',{ jobId, jobName })
  } catch (error) {
    events.emit('job:error', { error, body, jobId, jobName });
  }
}


module.exports = {
  post,
  downloadIGAva,
  verifyIG,
  sendEmail,
};
