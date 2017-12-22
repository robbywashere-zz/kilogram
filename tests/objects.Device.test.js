process.env.NODE_ENV = 'test'; // TODO ?

const sinon = require('sinon');
const assert = require('assert');
const sync = require('../db/sync');
const { Device } = require('../objects');
//const SequelizeMock = require('sequelize-mock');
//sinon.stub(DB,"$", new SequelizeMock())
beforeEach(async ()=> {
  return sync(true);
});


describe('register', function(){


  it('should register new devices given a set of ids', async function(){
  

    const oldDevice = await Device.create({
      adbId: 'did',
      online: true,
      idle: true,
    })

    await Device.register(['did']) // Doesn't throw an error

    await Device.register(['did2'])

    const newDevice = await Device.find({ where: { adbId: 'did2' } })

    assert.notEqual(newDevice.id, oldDevice.id)

    assert.equal(newDevice.adbId, 'did2')

    assert(newDevice.online)

    assert(newDevice.idle)
  
  
  });



})

describe('freeDangling', function(){

  it('should `free` devices where online:false, idle:false',async function(){
    await Device.create({ 
      online: false,
      idle: false,
      adbId: 'did'
    })
    await Device.freeDangling(['did']);
    const freed = await Device.findAll({ where: { online: true, idle: true }})

    assert.equal(1,freed.length)
  });


})

describe('free', function(){


  it('should return devices which are free - online: true, idle: true',async function(){
    await Device.create({ 
      online: true,
      idle: true,
      adbId: 'freeDevice'
    })
    const freeDevices = await Device.free();
    assert.equal(freeDevices[0].adbId,'freeDevice')
  });

})

describe('zombies', function(){

  it ('should report devices online:true, idle: false, updated more than 5 minutes ago', async function(){


    // Thanks to : https://github.com/sequelize/sequelize/issues/3759
    //
    const d = new Device({ idle: false, online: true, adbId: 'zombie' });

    const minutes = 5;

    let timeAgo = new Date((new Date()).getTime() - (minutes+1)*60000)
    let cutOff= new Date((new Date()).getTime() - (minutes)*60000)
    assert(timeAgo < cutOff) // Sanity checking

    d.set({
      updatedAt: timeAgo 
    }, { raw: true })

    d.changed('updatedAt', true)

    await d.save({
      silent: true,
      fields: ['updatedAt','idle','online', 'adbId']
    });

    const zombies = await Device.zombies(minutes);



    assert.equal(1,zombies.length);
    assert.equal(true, zombies[0].online)
    assert.equal(false,zombies[0].idle)


  })


});

describe('syncDevices', function(){
  it ('should update devices (online: true where in <adb devices ids> and (online: false where not in <adb device ids>)', async function(){

    const off = await Device.create({ 
      online: false,
      idle: true,
      adbId: 'id1'
    })

    const on = await Device.create({ 
      online: true,
      idle: false,
      adbId: 'id2'
    })

    await Device.syncOnline(['id1','did']);

    assert.equal(!off.online, (await Device.findById(off.id)).online)
    assert.equal(!on.online, (await Device.findById(on.id)).online)


  })

})


