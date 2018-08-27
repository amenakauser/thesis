const db = require('./index.js');
const assoc = require('./associations.js');
const Company = require('./Models/Company');
const User = require('./Models/User');
const Category = require('./Models/Category');
const Article = require('./Models/Article');
const Invitation = require('./Models/Invitation');
const Passwordreset = require('./Models/Passwordreset');


// This creates the tables in the database and their relationships.
assoc();

var dbHelpers = {

  /////////////////////
  //      USERS      //
  /////////////////////

  // creating a new user
  // check if a user exists for the given company, if yes, return false in callback
  // if no user exists for the given company, create a user with role 'admin', return true in callback
  addUser: ({name, email, password, company, domain}, cb) => {
    User.findOne({
      where: {email: email}
    })
    .then(result => {
      if (result !== null) {
        // a user already exists with this email
        cb(false, email, true)
      } else {
        // email is unique
        Company.findOne({
          where: {domain: domain}
        }).
        then(result => {
          if (result === null) {
            // create company
            Company.create({
              name: company,
              domain: domain
            })
            .then(result => {
              let companyId = result.id;
              // create user
              User.create({
                name: name,
                email: email,
                password: password,
                role: 'admin',
                companyId: companyId
              })
              .then(user => {
                let userInfo = {
                  name: user.name,
                  companyId: user.companyId,
                  role: user.role
                }
                cb(true, userInfo, null);
              })
            })
          } else {
            // an admin user exists for the given company
            cb(false, null, null);
          }
        })
      }
    })
  },

  // updating a user's password
  updatePassword: ({userId, hash}, cb) => {
    User.find({
      where: {id: userId}
    }).
    then(user => {
      if (user) {
        user.update({
          password: hash
        })
        .then(result => cb(true));
      } else {
        cb(false);
      }
    })

  },

  // find a user and pass it to the callback function
  findUser: ({email}, cb) => {
    User.findOne({
      where: {email: email}
    })
    .then(result => {
      if (result === null){
        cb(result)
      } else {
        cb(result.dataValues)
      }
    })
  },


    /////////////////////
  //     INVITATIONS    //
  /////////////////////

  // save companyId, email, hash and role in invitations table
  addInvite: ({companyId, email, hash, role}, cb) => {
    let invite = Invitation.build({
      companyId: companyId,
      email: email,
      hash: hash,
      role: role
    });
    invite.save()
    .then(done => {
      cb(true);
    });
  },

  checkInvite: (hash, cb) => {
    Invitation.find({
      where: {hash: hash}
    })
    .then(invite => {
      if (invite === null) {
        cb(null);
      } else {
        let companyId = invite.dataValues.companyId;
        let email = invite.dataValues.email;
        let role = invite.dataValues.role;
        invite.destroy();
        cb(companyId, email, role);
      }
    });
  },

  addUserWithCode: ({email, name, password, role, companyId}, cb) => {
    let user = User.build({
      email: email,
      name: name,
      password: password,
      role: role,
      companyId: companyId
    });
    user.save()
    .then(done => {
      cb(true);
    })
  },


  /////////////////////
  //    COMPANIES    //
  /////////////////////

  // creating a company
  addCompany: (obj) => {},

  fetchCompanyData: (companyId, cb) => {
    Company.findAll({
      where: {
        id: companyId
      },
      attributes: ['id', 'name', 'domain']
    })
    .then(results => {
      cb(results);
    })
  },

  findUserCompany: (userId, cb) => {
    User.findOne({where: {id: userId}}).then(user => Company.findOne({where: {id: user.companyId}}).then(company => cb(company.name)))
  },


  /////////////////////
  //    CATEGORIES   //
  /////////////////////

  // create a category
  addCategory: ({name, description, companyId}, cb) => {
    Category.findOrCreate({
      where: {name: name, companyId: companyId}, defaults: {description: description}
    })
    .spread((user, created) => {
      cb(created);
    })
  },

  // update a Category's name or description
  updateCategory: (obj, cb) => {
    Category.findOne({where: {id: obj.id}}).then(cat => {
      cat.update({
        name: obj.name,
        description: obj.description
      }).then(cat => cb(cat));
    })
  },

  // removing a category
  deleteCategory: (obj, cb) => {
    Article.findAll({where: {id: obj.id}})
    .then(articles => {
      articles.forEach(article => article.update({companyId: null}))
    })
    .then(() => {Category.findOne({where: {id: obj.id}})
      .then(category => {category.destroy()})
      .then(() => Category.findAll({where: {companyId: obj.coId}})
        .then(categories => {cb(categories);}))
    })
  },

  // fetch all categories for the given company id
  fetchCategoriesByCompany: (companyId, cb) => {
    Category.findAll({
      where: {
        companyId: companyId
      },
      order: [
        ['id', 'DESC']
      ],
      attributes: ['id', 'name', 'description', 'companyId']
    })
    .then(results => {
      cb(results);
    })
  },

  /////////////////////
  //     ARTICLES    //
  /////////////////////

  // create an article with content
  addArticle: (catId, obj, coId, cb) => {
    Category.findOne({where: {id: catId}}).then(foundCat => {
      let newArt = Article.build({
        title: obj.title,
        description: obj.description,
        content: obj.content,
        companyId: coId
      })

      newArt.setCategory(foundCat, {save: false});
      newArt.save().then((article) => cb(article.dataValues))

    })
  },

  // update an article
  updateArticle: (article, cb) => {
    Article.findById(JSON.parse(article).id)
    .then(record => {
      if (record === null){
        cb(record)
      } else {
        record.update({
          title: JSON.parse(article).title,
          description: JSON.parse(article).description,
          content: JSON.parse(article).content,
          categoryId: JSON.parse(article).categoryId
        })
        .then(response => cb(response))
        cb(record.dataValues)
      }
    })
  },

  // delete an article
  deleteArticle: (id, cb) => {
    Article.destroy({
      where: {
        id: id
      }
    })
    .then(response => cb(response))
  },

  fetchCategoryArticlesFirstLastPg: (limit, categoryId, {companyId}, cb) => {
    let countAndPages = {};
    Article.count({
      where: {
        companyId: companyId,
        categoryId: parseInt(categoryId)
      }
    })
    .then(c => {
      countAndPages.count = c;
      Article.findAll({
        limit: parseInt(limit),
        offset: Math.ceil(c / limit),
        where: {
          companyId: companyId,
          categoryId: parseInt(categoryId)
        },
        order: [
          ['id', 'DESC']
        ],
        attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
      })
      .then(lastPage => {
        countAndPages.lastPage = lastPage;
        Article.findAll({
          limit: parseInt(limit),
          offset: 0,
          where: {
            companyId: companyId,
            categoryId: parseInt(categoryId)
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
        .then(firstPage => {
          countAndPages.firstPage = firstPage;
          Article.findAll({
            limit: parseInt(limit),
            offset: limit -1 ,
            where: {
              companyId: companyId,
              categoryId: parseInt(categoryId)
            },
            order: [
              ['id', 'DESC']
            ],
            attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
          })
          .then(nextPage => {
            countAndPages.nextPage = nextPage;
            cb(countAndPages);
          })
        })
      })
    })
  },

  fetchCategoryArticlesPage: (page, limit, totalPages, categoryId, {companyId}, cb) => {
    let offset = limit * (page - 1) || 0;
    let pages = {};
    Article.findAll({
      limit: parseInt(limit),
      offset: offset,
      where: {
        companyId: companyId,
        categoryId: parseInt(categoryId)
      },
      order: [
        ['id', 'DESC']
      ],
      attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
    })
    .then((currentPage) => {
      pages.currentPage = currentPage;
      if(page > 1) {
        return Article.findAll({
          limit: parseInt(limit),
          offset: offset - limit,
          where: {
            companyId: companyId,
            categoryId: parseInt(categoryId)
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
      } else {
        return null;
      }
    })
    .then(previousPage => {
      pages.previousPage = previousPage;
      if(page < parseInt(totalPages)) {
        return Article.findAll({
          limit: parseInt(limit),
          offset: offset + parseInt(limit),
          where: {
            companyId: companyId,
            categoryId: parseInt(categoryId)
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
      } else {
        return null;
      }
    })
    .then(nextPage => {
      pages.nextPage = nextPage;
      cb(pages);
    })
  },


  fetchCompanyArticlesFirstLastPg: (limit, {companyId}, cb) => {
    let countAndPages = {};
    Article.count({
      where: {
        companyId: companyId
      }
    })
    .then(c => {
      countAndPages.count = c;
      Article.findAll({
        limit: parseInt(limit),
        offset: Math.ceil(c / limit),
        where: {
          companyId: companyId
        },
        order: [
          ['id', 'DESC']
        ],
        attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
      })
      .then(lastPage => {
        countAndPages.lastPage = lastPage;
        Article.findAll({
          limit: parseInt(limit),
          offset: 0,
          where: {
            companyId: companyId
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
        .then(firstPage => {
          countAndPages.firstPage = firstPage;
          Article.findAll({
            limit: parseInt(limit),
            offset: limit -1 ,
            where: {
              companyId: companyId
            },
            order: [
              ['id', 'DESC']
            ],
            attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
          })
          .then(nextPage => {
            countAndPages.nextPage = nextPage;
            cb(countAndPages);
          })
        })
      })
    })
  },

  fetchCompanyArticlesPage: (page, limit, totalPages, {companyId}, cb) => {
    let offset = limit * (page - 1) || 0;
    let pages = {};
    Article.findAll({
      limit: parseInt(limit),
      offset: offset,
      where: {
        companyId: companyId
      },
      order: [
        ['id', 'DESC']
      ],
      attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
    })
    .then((currentPage) => {
      pages.currentPage = currentPage;
      if(page > 1) {
        return Article.findAll({
          limit: parseInt(limit),
          offset: offset - limit,
          where: {
            companyId: companyId
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
      } else {
        return null;
      }
    })
    .then(previousPage => {
      pages.previousPage = previousPage;
      if(page < parseInt(totalPages)) {
        return Article.findAll({
          limit: parseInt(limit),
          offset: offset + parseInt(limit),
          where: {
            companyId: companyId
          },
          order: [
            ['id', 'DESC']
          ],
          attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
        })
      } else {
        return null;
      }
    })
    .then(nextPage => {
      pages.nextPage = nextPage;
      cb(pages);
    })
  },

  fetchOneArticle: (id, cb) => {
    Article.findAll({
      where: {
        id: id,
      },
      attributes: ['id', 'title', 'description', 'content', 'categoryId', 'companyId']
    })
    .then(results => {
      cb(results);
    })
  },

  //////////////////////////////
  //    TEST DATA FUNCTIONS   //
  //////////////////////////////

  clearTables: () => {
    Article.findAll().then(articles => articles.forEach(event => article.destroy()));
    Category.findAll().then(categories => categories.forEach(category => category.destroy()));
    User.findAll().then(users => users.forEach(user => user.destroy()));
    Company.findAll().then(companies => companies.forEach(company => company.destroy()));
  },

  dropTables: () => {
    db.drop();
  },

  recreateDB: () => {
    Company.sync().then(() => User.sync().then(() => Category.sync().then(() => Article.sync())));
  },

  dummyData: () => {
    //create company first
    let testCompany = Company.build({
      name: 'Test Company', domain: 'testcompany.com'
    })

    testCompany.save().then(company => {
      // create user after companyId
      let testUser = User.build({
        email: 'tester@gmail.com',
        role: 'admin',
        // password is 'testing123'
        password: '$2b$10$k0rGBI/RMrXvn/S03z11MuiGBCRBkeUAXJq6VK4uRJNfT642slPdO',
        name: 'Test Account'
      })

      // associate user with company
      testUser.setCompany(company, {save: false});

      // save user
      testUser.save();

      for (var i = 0; i < 5; i++) {

        // create category after company
        let testCategory = Category.build({
          name: `Test Category${i+1}`,
          description: `Test Description${i+1}`
        });

        // associate category with company
        testCategory.setCompany(company, {save: false});

        // save category
        testCategory.save().then(category => {

          for (var j = 0; j < 10; j++) {
            let testArticle = Article.build({
              title: `Test Article${category.id}-${j}`,
              description: `Test Article Description${category.id}-${j}`,
              content: `Test Content yada yada yada${category.id}-${j}.
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum`
            });

            // associate article with category
            testArticle.setCategory(category, {save: false});
            // associate article with company
            testArticle.setCompany(company, {save: false});

            // save article and all is done
            testArticle.save();
          }

        })
      }

    })
  },

      /////////////////////
  //     PASSWORD RESETS   //
  /////////////////////

  addPasswordReset: ({resetHash, userId}, cb) => {
    let instance = Passwordreset.build({
      resetHash: resetHash,
      userId: userId
    });
    instance.save()
    .then(result => {
      cb(true);
    })
  },

  verifyPwdReset: ({ hash: hash }, cb) => {
    Passwordreset.find({
      where: {resetHash: hash}
    })
    .then(result => {
      if (result) {
        let userId = result.userId;
        result.destroy();
        cb(false, userId);
      } else {
        cb(true);
      }
    })
  }

}

module.exports = dbHelpers;
