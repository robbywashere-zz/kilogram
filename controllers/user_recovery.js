const { Router } = require('express');

const { NotFound, BadRequest } = require('http-errors');

const { UserRecovery, User } = require('../objects');

const emailer = require('../server-lib/emailer');

const { logger } = require('../lib/logger');

const { get } = require('lodash');

const { userRecoveryEmail } = require('../emails');

const { genPasswordKey } = require('../objects/_helpers');

const router = new Router();

//TODO limit security
router.post('/:email', async (req, res, next) => {
  try {
    const { email } = req.params;
    const user = await User.newRecovery(email)
    if (!user) throw new NotFound(); // TODO: return res.sendStatus(200) more secure?
    const recoveryEmail = new emailer();
    await recoveryEmail.send({ msg: userRecoveryEmail({ key: user.passwordKey }), to: user.email });
    res.sendStatus(200)
  } catch(err) {
    logger.error(err);
    next(err);
  }
})

router.put('/', async(req, res, next) => {
  try {
    const { password, passwordKey, email } = req.body;
    if (!passwordKey || !password || !email) throw new BadRequest();
    await User.recover({ password, passwordKey, email });
    res.sendStatus(200);
  } catch(err) {
    logger.error(err);
    next(err);
  }
})

module.exports = router
