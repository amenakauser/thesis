const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressValidator = require('express-validator');
const randomstring = require('randomstring');

const db = require('../db/helpers.js');
const apidb = require('../db/apiHelpers.js');
const sessionStore = require('../db/Models/Session.js');
const sendmail = require('../services/sendmail.js');
const config = require('../config.js');
const AWS = require('aws-sdk');
const axios = require('axios');
// const esUrl = 'http://localhost:8080';
const esUrl = 'http://ec2-18-233-153-214.compute-1.amazonaws.com:8080';

const s3 = new AWS.S3({
  accessKeyId: config.S3.accessKeyId,
  secretAccessKey: config.S3.secretAccessKey,
  Bucket: config.S3.Bucket,
  apiVersion: config.S3.apiVersion,
});

const Hashids = require('hashids');
const hashids = new Hashids('knowhow-api', 16);

const app = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;

// this salt is used only for inviting a new user and password recovery
const salt = '$2a$10$8WIft9tqyYTZKQASFhGBYe';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(expressValidator()); // this line must be immediately after any of the bodyParser middlewares

app.use(express.static(path.resolve(__dirname, '../client/dist')));

app.use(session({
  secret: 'lalalala',
  cookieName: 'ASTA', // cookie name dictates the key name added to the request object
  store: sessionStore,
  resave: false,
  saveUninitialized: false // only save sessions for users that are logged in
  // ,cookie: { secure: true }
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport will maintain persistent login sessions. In order for persistent sessions to work, the authenticated user must be serialized to the session, and deserialized when subsequent requests are made.
passport.serializeUser((name, done) => {
  done(null, name);
});

passport.deserializeUser((name, done) => {
  done(null, name);
});

// middleware to check if user is logged in
var authMiddleware = function () {
  return (req, res, next) => {
    // console.log(`req.session.passport.user: ${req.session.passport}`);
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/');
  }
};

// middleware to check if user has 'admin' role
var admin = function() {
  return (req, res, next) => {
    if (req.user.role === 'admin') {
      return next();
    }
    res.redirect('/');
  }
}

// if user is authenticated, redirect to homepage if they try accessing signup/login pages
app.get('/signup', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/home');
  } else {
    res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
  }
});

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/home');
  } else {
    res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
  }
});

app.get('/signupwithcode', (req, res) => {
  res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
});

app.get('/forgotpassword', (req, res) => {
  res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
});

app.get('/resetpassword', (req, res) => {
  res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
});

app.post('/signupuser', (req, res) => {
  // data validation using express-validator
  req.checkBody('email', 'The email you entered is invalid. Please try again.').isEmail();
  req.checkBody('password', 'Password must be between 8-100 characters long.').len(8, 100);
  var errors = req.validationErrors();
  if (errors) {
    let data = { signup: false, errors: errors };
    res.send(data);
  } else {
    let password = req.body.password;
    // hash the password by auto-gen a salt and hash
    bcrypt.hash(password, saltRounds, (err, hash) => {
      // store hash in database
      if (hash) {
        db.addUser({ name: req.body.name, email: req.body.email, password: hash, company: req.body.company, domain: req.body.domain}, (isUserCreated, userInfo, error) => {
          if (error) {
            let data = { signup: false, message: 'duplicate email' };
            res.send(data);
          } else if (isUserCreated) {
            // login comes from passport and creates a session and a cookie for the user
            // make passport store userInfo in req.user
            req.login(userInfo, (err) => {
              if (err) {
                console.log(err);
                res.sendStatus(404);
              } else {
                let data = { signup: true, userInfo: userInfo };
                res.send(data);
              }
            });
          } else {
            let data = { signup: false, message: 'user exists' };
            res.send(data);
          }
        });
      }
    });
  }
});

app.post('/signupuserwithcode', (req, res) => {
  var code = req.query.code;
  var name = req.query.name;
  var password = req.query.password;
  // hash the code and see if there's a match in invitations table
  bcrypt.hash(code, salt, (err, hash) => {
    if (hash) {
      db.checkInvite(hash, (companyId, email, role) => {
        if (companyId === null) {
          res.send('Invalid code');
        } else {
          // valid code, sign up user; assume that email is unique
          bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
            if (hashedPassword) {
              db.addUserWithCode({ email: email, name: name, password: hashedPassword, role: role, companyId: companyId }, (userCreated) => {
                // make passport store userInfo (name, companyId and role) in req.user
                var userInfo = { name: name, companyId: companyId, role: role };
                req.login(userInfo, (err) => {
                  if (err) {
                    console.log(err);
                    res.sendStatus(404);
                  } else {
                    let data = { signup: true, name: name, companyId: companyId, role: role };
                    res.send(data);
                  }
                });
              });
            }
          });
        }
      });
    }
  });
});

app.post('/inviteuser', admin(), (req, res) => {
  var companyId = req.user.companyId;
  var role = req.body.role;
  var email = req.body.email;
  // generate a random string composed of 8 chars from A-Z, a-z, 0-9
  var code = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 8; i++) {
    code += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  // hash the generated random code using a salt
  bcrypt.hash(code, salt, (err, hash) => {
    if (hash) {
      // save companyId, email, hash and role in invitations table
      companyId = hashids.decode(companyId)[0];
      db.addInvite({companyId, email, hash, role}, (saved) => {
        if (saved) {
          // send invitation email containing role and generated code
          var to = req.body.email;
          var subject = 'Invitation to join Know-how';
          // TODO - after deploying app, send a clickable link in email
          // TODO - add some basic info about know-how in the invitation email
          var html = `<p>Enter the following code to sign up on Know-how</p>
          <strong>code : ${code}</strong>`;
          sendmail(to, subject, html);
          res.send('Invitation sent');
        }
      });
    }
  });
});

app.post('/loginuser', (req, res) => {
  db.findUser({
    email: req.body.email
  }, (user) => {
    if (user !== null) {
      db.findUserCompany(user.id, foundCompany => {
        let hash = user.password;
        let comparePassword = req.body.password;
        let name = user.name;
        let hashedCompanyId = hashids.encode(user.companyId)
        bcrypt.compare(comparePassword, hash, (err, result) => {
          if (result) { // valid user
            let userInfo = { user: user.name, companyId: hashedCompanyId, role: user.role, company: foundCompany };
            // make passport store userInfo (name, companyId and role) in req.user
            req.login(userInfo, (err) => {
              if (err) {
                console.log(err);
                res.sendStatus(404);
              } else {
                let response = { user: user.name, companyId: hashedCompanyId, role: user.role, company: foundCompany, found: true };
                res.send(response);
              }
            });
          } else { // invalid user
            let response = { found: false };
            res.send(response);
          }
        });
      })
    } else {
      res.send('no user');
    }
  });
});

app.post('/forgotpwd', (req, res) => {
  let email = req.query.email;
  // check if email exists in users table
  db.findUser({email: email}, (user) => {
    if (user) {
      // if yes, generate random code of 8 chars; hash it with salt and save in passwordresets table along with user id
      let code = randomstring.generate(8);
      bcrypt.hash(code, salt, (err, hash) => {
        if (hash) {
          db.addPasswordReset({ resetHash: hash, userId: user.id }, (done) => {
            if (done) {
              // send code in email and ask user to enter code at myapp.com/resetpassword to choose a new password
              var to = email;
              var subject = 'Know-how password change request';
              // TODO - send appropriate link after deploying app
              var html = `<h1>Change your password</h1><p>We have received a password change request for your Know-how account.</p><p>If you did not ask to change your password, then you can ignore this email and your password will not be changed.</p><p>If you want to change your password, go to myapp.com/resetpassword and enter the following code: ${code}</p><p>The code with only work once to reset your password.</p>`
              sendmail(to, subject, html);
            }
          });
        }
      })
    }
  })
  res.send('OK')
});

app.post('/resetpwd', (req, res) => {
  let code = req.body.code;
  let password = req.body.password;
  // hash code with salt
  bcrypt.hash(code, salt, (err, hash) => {
    // check if record with hash exists in passwordresets table
    db.verifyPwdReset({ hash: hash }, (err, userId) => {
      if (!err) {
        // if userId is found, hash password and update users table with new hash
        bcrypt.hash(password, saltRounds, (err, hash) => {
          if (hash) {
            db.updatePassword({ userId: userId, hash: hash }, (changed) => {
              if (changed) {
                res.send('password changed');
              }
            })
          }
        })
      } else {
        // if no, send response that code is invalid
        res.send('invalid code');
      }

    })
  })
});

app.post('/addCategory', authMiddleware(), (req, res) => {
  let name = req.body.categoryName;
  let description = req.body.categoryDescription;
  let companyId = req.user.companyId;
  companyId = hashids.decode(companyId);
  db.addCategory({name, description, companyId}, (created) => {
    res.send(created);
  });
});

app.post('/updatecategory', authMiddleware(), (req, res) => {
  db.updateCategory(req.body, updated => {
    res.end(JSON.stringify(updated));
  })
});

app.post('/deletecategory', authMiddleware(), (req, res) => {
  db.deleteCategory(req.body, categories => {
    res.end(JSON.stringify(categories));
  })
})

app.get('/:companyId/categoriesdata', authMiddleware(), (req, res) => {
  let companyId = hashids.decode(req.params.companyId);
  db.fetchCategoriesByCompany(companyId, (categories) => {
    res.send(categories);
  })
});

app.get('/:companyId/articlesfirstlastpg/:per/:categoryId?', authMiddleware(), (req, res) => {
  let companyId = hashids.decode(req.params.companyId);
  if(req.params.categoryId) {
    db.fetchCategoryArticlesFirstLastPg(req.params.per, req.params.categoryId, {companyId}, (results) => {
      res.send(results);
    })
  } else {
    db.fetchCompanyArticlesFirstLastPg(req.params.per, {companyId}, (results) => {
      res.send(results);
    });
  }
});

app.get('/:companyId/articlesdata/:pg/:per/:total/:categoryId?', authMiddleware(), (req, res) => {
  let companyId = hashids.decode(req.params.companyId);
  if(req.params.categoryId) {
    db.fetchCategoryArticlesPage(req.params.pg, req.params.per, req.params.total, req.params.categoryId, {companyId}, (results) => {
      res.send(results);
    })
  } else {
    db.fetchCompanyArticlesPage(req.params.pg, req.params.per, req.params.total, {companyId}, (pages) => {
      res.send(pages);
    });
  }
});

app.post('/article', authMiddleware(), (req, res) => {
  let data = req.body;
  let companyId = hashids.decode(req.session.passport.user.companyId);
  //update if exists
  if(req.body.id) {
    axios.patch(`${esUrl}/api/updatearticle`, req.body)
    .then(result => {
      if (result.data) {
        db.updateArticle(JSON.stringify(req.body), () => res.end(`${req.body.title} has been updated`));
      }
    })
  } else {
    db.addArticle(data.categoryId, data, companyId, (response) => {
      axios.post(`${esUrl}/api/addarticle`, response)
      .then(result => {
        res.send(result.data);
      })
    })
  }
});


app.post('/deleteArticle', authMiddleware(), (req, res) => {
  axios.delete(`${esUrl}/api/deletearticle/${req.body.articleId}`)
  .then(result => {
    if (result.data) {
      db.deleteArticle(req.body.articleId, () => res.redirect('/home'));
    }
  })
})

// get articles containing a given search term
app.get('/search', authMiddleware(), (req, res) => {
  let term = req.query.term;
  let companyId = req.user.companyId;
  companyId = hashids.decode(companyId)[0];
  let url = `${esUrl}/api/search?term=${term}&companyId=${companyId}`
  axios.get(url)
  .then(response => {
    let results = response.data;
    res.send(results)
  });
});

app.post('/uploadimage', authMiddleware(), (req, res) => {
  let buffer = new Buffer(req.body.data, 'base64');
  s3.putObject({
    Bucket: config.S3.Bucket,
    Key: `${req.body.imageKey}`,
    Body: buffer,
    ACL: 'public-read'
  },function (resp) {
    res.status(201).send(arguments);
  });
});

app.get('/company', authMiddleware(), (req, res) => {
  let companyId = req.user.companyId;
  db.fetchCompanyData(companyId, (data) => {
    res.send(data[0].name);
  })
})

// to get name and companyId of logged in user
app.get('/user', (req, res) => {
  res.send(req.user);
});

app.get('/logout', (req, res) => {
  // req.logout is a function available from passport
  req.logout();
  // destroy session for the user that has been logged out
  req.session.destroy();
  // logout user
  res.send('logged out')
});


//////////////////////////
//    API routes     //
//////////////////////////

// wrapper function for asycn await error handling
let wrap = fn => (...args) => fn(...args).catch(args[2]);

app.get('/api/:hashedcompanyId', wrap(async (req, res) => {
  try {
    //enable CORS for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    // var id = hashids.encode(1);
    // console.log("hashed version of company id 1 is : ", id)
     //1 -> NGp3aq8Qq8kQZKrM
    let CompanyId = hashids.decode(req.params.hashedcompanyId);
    let data = await apidb.fetchCompanyData(CompanyId);
    res.json(data);
  } catch(error) {
    res.status(500).json({ error: error.toString() });
  }
}));


app.get('/api/:hashedcompanyId/article/:hashedarticleId', wrap(async(req, res) => {
  try{
    //enable CORS for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    let CompanyId = hashids.decode(req.params.hashedcompanyId);
    let articleId = hashids.decode(req.params.hashedarticleId);
    let article = await apidb.fetchOneArticle(CompanyId, articleId);
    res.json(article);
  } catch(err) {
    res.status(500).json({ error: error.toString() });
  }
}));

// get all categories for a given company id
app.get('/api/:hashedcompanyId/categoriesdata', wrap(async(req, res) => {
  try{
    //enable CORS for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    let CompanyId = hashids.decode(req.params.hashedcompanyId);
    let categories = await apidb.fetchCategoriesByCompany(CompanyId);
    let hashedCategories = categories.map(category => {
      category.dataValues.id = hashids.encode(category.dataValues.id);
      category.dataValues.companyId = hashids.encode(category.dataValues.id);
      return category;
    })
    res.json(categories);
  } catch(err) {
    res.status(500).json({ error: error.toString() });
  }
}));

// get all articles for a given company id and category id
app.get('/api/:hashedcompanyId/categories/:hashedcategoryId/articlesdata', wrap(async(req, res) => {
  try{
    console.log("THE API FOR /api/:hashedcompanyId/categories/:hashedcategoryId/articlesdata is being called!")
    //enable CORS for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    let CompanyId = hashids.decode(req.params.hashedcompanyId);
    let categoryId = hashids.decode(req.params.hashedcategoryId);
    let articles = await apidb.fetchArticles(CompanyId, categoryId);
    res.json(articles);
  } catch(err) {
    res.status(500).json({ error: err.toString() });
  }
}));

// get all articles for a given company id
app.get('/api/:hashedcompanyId/articlesdata', wrap(async(req, res) => {
  try{
    //enable CORS for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    let CompanyId = hashids.decode(req.params.hashedcompanyId);
    let articles = await apidb.fetchCompanyArticles(CompanyId);
    res.json(articles);
  } catch(err) {
    res.status(500).json({ error: err.toString() });
  }
}));

// get articles containing a given search term
app.get('/api/:hashedCompanyId/search', (req, res) => {
  //enable CORS for this route
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD');
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  let term = req.query.term;
  let companyId = hashids.decode(req.params.hashedCompanyId)[0];
  let url = `${esUrl}/api/search?term=${term}&companyId=${companyId}`
  axios.get(url)
  .then(response => {
    let results = response.data;
    res.send(results)
  });
});


//////////////////////////
//    DB dev routes     //
//////////////////////////

// unprotect /devadminpage
app.get('/devadminpage', (req, res) => {
  res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
});

app.get('/db/testfill', (req, res) => {
  db.dummyData();
  res.end('Test data added to DB');
})

app.get('/db/clear', (req, res) => {
  db.clearTables();
  res.end('All tables cleared');
})

app.get('/db/rebuild', (req, res) => {
  db.recreateDB();
  res.end('DB is rebuilt')
})

// protect routes
app.get('*', authMiddleware(), (req, res) => {
  res.sendFile(path.join(__dirname, '/../client/dist/index.html'));
});

app.listen(process.env.PORT !== undefined ? process.env.PORT : PORT, () => {
  console.log(`listening on port ${PORT}`);
});
