
const Jwt = require('../server-lib/auth/jwt');
const Auth = require('../server-lib/auth');
const express = require('express');
const assert = require('assert');
const supertest = require('supertest');
const { Account, User } = require('../objects');
const { appLogger } = require('./helpers');
const DBSync = require('../db/sync');

const { CookieSession, PGSession } = require('../server-lib/auth/session');


describe.only('server-lib/auth', function(){

  beforeEach(()=>DBSync(true))

  it('should auth with JWT', async function(){

    const user = await User.create({ email: 'test@test.com', password:'blah', Accounts: [{}]},{ include: [ Account ] })

    const app = new express();

    appLogger(app);

    app.use(Jwt(app));


    const res1 = await supertest(app)
      .post('/auth')
      .send({ username: 'test@test.com', password: 'blah' })
      .expect(200);

    const { token } = res1.body;

    const res2 = await supertest(app)
      .get('/auth')
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200)

    assert.equal(res2.body.id,user.id);
    assert(res2.body.Accounts[0]);
    assert.equal(res2.body.Accounts[0].id, user.Accounts[0].id)


    const res3 = await supertest(app)
      .get('/auth')
      .expect(401)
  });


  it(`
      - should login a user
      - store user information in POSTGRES
      - passport should make available user data on 'request' object'
  `, async function(){

    const user = await User.create({ email: 'test@test.com', password:'blah'})

    const app = new express();


    app.use(Auth(app, { sessionStrategy: PGSession } ));

    app.get('/testpassport',function(req, res){
      res.send(req.user);
    })

    appLogger(app);

    const agent = supertest.agent(app);

    const res1 = await agent
      .post('/auth')
      .send({ username: 'test@test.com', password: 'blah' })
      .expect(200)
      

    assert.equal(res1.body.user.email, 'test@test.com');

    const { body: userdata }= await agent.get('/testpassport');

    assert.equal(userdata.id, 1);

    assert.equal(userdata.email, 'test@test.com');

    assert.equal(userdata.Accounts[0].id, 1);

    const res2 = await supertest(app)
      .post('/auth')
      .send({ username: 'test@test.com', password: 'wrong' })
      .expect(401)

    assert.equal(res2.user, undefined)

    const res3 = await agent
      .delete('/auth')
      .expect(200);
    assert.equal(res3.user, undefined)

  })


  it(`
      - should login a user
      - store user information in COOKIE
      - passport should make available user data on 'request' object'
  `, async function(){

    const cookie = require('cookie');
    const user = await User.create({ email: 'test@test.com', password:'blah'})

    const app = new express();


    app.use(Auth(app, { sessionStrategy: CookieSession } ));

    app.get('/testpassport',function(req, res){
      res.send(req.user);
    })

    appLogger(app);

    const agent = supertest.agent(app);

    const res1 = await agent
      .post('/auth')
      .send({ username: 'test@test.com', password: 'blah' })
      .expect(200)
      

    assert.equal(res1.body.user.email, 'test@test.com');

    const { body: userdata }= await agent.get('/testpassport');

    assert.equal(userdata.id, 1);

    assert.equal(userdata.email, 'test@test.com');

    assert.equal(userdata.Accounts[0].id, 1);

    const res2 = await supertest(app)
      .post('/auth')
      .send({ username: 'test@test.com', password: 'wrong' })
      .expect(401)

    assert.equal(res2.user, undefined)

    const res3 = await agent
      .delete('/auth')
      .expect(200);
    assert.equal(res3.user, undefined)

  })


})
