const sequelize = require('sequelize');
const {
  STRING
} = sequelize;
const cryptoRandomString = require('crypto-random-string');
const { isLoggedIn } = require('./_helpers');

module.exports = {
  Name: 'UserInvite',
  Properties: {
    key: {
      type: STRING,
      defaultValue: () => cryptoRandomString(32),
    },
    email: {
      type: STRING,
      allowNull: false,
      unique: 'compositeIndex',
      validate: {
        isEmail: true,
      },
    },
  },
  PolicyScopes: {},
  Authorize: {
    all: isLoggedIn,
  },
  PolicyAttributes: {},
  PolicyAssert: false, // TODO: haha
  ScopeFunctions: true,
  Scopes: {
  },
  AuthorizeInstance: {
    all(user) {
      try {
        return user.Accounts.map(a => a.id).includes(this.accountId);
      } catch (e) {
        return false;
      }
    },
  },
  Hooks: {
    /* afterUpdate: async function(instance){
      const { password, email } = instance;
      const { User } = this.sequelize.models;
      const user = await User.find({ where: { email }});
      await user.update({ verified: true, password })
      return instance.destroy();
    }, */
    async beforeCreate(instance) {
      if (!instance.User) {
        const { email, Account } = instance;
        const $ = this.sequelize.models;
        let user = await $.User.findOne({ where: { email } });
        if (!user) {
          user = await $.User.create({
            email,
            verified: false,
            password: cryptoRandomString(32),
            Accounts: [Account],
          }, { include: [$.Account] });
        }
        instance.UserId = user.id;
      }
    },
  },
  Methods: {
    async redeem() {
      const { User } = this.sequelize.models;
      const user = await User.findOne({ where: { id: this.UserId } });
      await Promise.all([
        user.addAccount(this.AccountId),
        this.destroy(),
      ]);
      return user;
    },
  },
  StaticMethods: {
  },

  Init({ Account, User }) {
    this.belongsTo(User);
    this.belongsTo(Account, {
      foreignKey: {
        allowNull: false,
        unique: 'compositeIndex',
      },
    });
  },
};

