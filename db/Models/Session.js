var session = require('express-session');
var connection = require('../../db');

// initalize sequelize with session store
var SequelizeStore = require('connect-session-sequelize')(session.Store);

var sessionStore = new SequelizeStore({
  db: connection,
  checkExpirationInterval: 15 * 60 * 1000, // The interval at which to cleanup expired sessions in milliseconds.
  expiration: 1 * 60 * 60 * 1000  // The maximum age (in milliseconds) of a valid session.
})

console.log('making session store', sessionStore)

module.exports = sessionStore;