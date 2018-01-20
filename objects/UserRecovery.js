const sequelize = require('sequelize');
const crypto = require('crypto');
const hashify = require('../server-lib/auth/hashify');
const { STRING, JSON, INTEGER, VIRTUAL, BOOLEAN, Op } = sequelize;
const cryptoRandomString = require('crypto-random-string');

const createdAt  = { [Op.gte] : sequelize.fn(`NOW() - INTERVAL '24 hours' --`) }

module.exports = {
  Name: 'UserRecovery',
  Properties:{
    key: {
      type: STRING,
      defaultValue: ()=> cryptoRandomString(32)
    },
  },
  PolicyScopes:{},
  Authorize: {
    all: function(user){
      return user.admin
    },
  },
  PolicyAttributes:{},
  PolicyAssert: true,
  ScopeFunctions: true, 
  Scopes: {
    forKey: function(key) { return { where: { key, createdAt },  include: [ this.sequelize.models.User ] } }
  },
  Hooks: {
  },
  Methods:{
  },
  StaticMethods: {
  },
  Init({ User }){
    this.belongsTo(User);
  },
}

