var Mongoose = require('mongoose');
var _        = require('lodash');
var Async    = require('async');
var shortId  = require('shortid');
var should   = require('chai').should();
var Tree     = require('../lib/tree');

var Schema       = Mongoose.Schema;
Mongoose.Promise = global.Promise;
Mongoose.connect('mongodb://localhost:27017/mongoose-path-tree', {useMongoClient: true});

describe('tree tests', function() {
  var userSchema = {
    name: String,
  };

  var pluginOptions = {
    pathSeparator: '.',
    onDelete: 'REPARENT',
  };

  if ('1' === process.env.MONGOOSE_TREE_SHORTID) {
    userSchema._id = {
      type: String,
      unique: true,
      'default': function() {
        return shortId.generate();
      },
    };

    pluginOptions.idType = String;
  }

  // Schema for tests
  var UserSchema = new Schema(userSchema);
  UserSchema.plugin(Tree, pluginOptions);
  var User = Mongoose.model('User', UserSchema);

  // Set up the fixture
  beforeEach(function(done) {
    User.remove({}, function(err) {
      should.not.exist(err);

      var adam  = new User({name: 'Adam'});
      var bob   = new User({name: 'Bob', parent: adam});
      var carol = new User({name: 'Carol', parent: adam});
      var dann  = new User({name: 'Dann', parent: carol});
      var emily = new User({name: 'Emily', parent: dann});
      var frank  = new User({name: 'Frank'});

      Async.forEachSeries(
          [adam, bob, carol, dann, emily, frank],
          function(doc, callback) {
            doc.save(callback);
          },
          done
      );
    });
  });

  describe('saving documents', function() {
    it('should set parent id and path', function(done) {
      User.find({}, function(err, users) {
        should.not.exist(err);

        var userPerName = {};
        users.forEach(function(user) {
          userPerName[user.name] = user;
        });

        should.not.exist(userPerName['Adam'].parent);
        userPerName['Bob'].parent.toString().should.equal(userPerName['Adam']._id.toString());
        userPerName['Carol'].parent.toString().should.equal(userPerName['Adam']._id.toString());
        userPerName['Dann'].parent.toString().should.equal(userPerName['Carol']._id.toString());
        userPerName['Emily'].parent.toString().should.equal(userPerName['Dann']._id.toString());

        var expectedPath = [
          userPerName['Adam']._id,
          userPerName['Carol']._id,
          userPerName['Dann']._id,
        ].join('.');

        userPerName['Dann'].path.should.equal(expectedPath);

        done();
      });
    });
  });

  describe.only('removing document', function() {
    it('should remove leaf nodes', function(done) {
      User.findOne({name: 'Emily'}, function(err, emily) {
        emily.remove(function(err) {
          should.not.exist(err);

          User.find(function(err, users) {
            should.not.exist(err);

            users.length.should.equal(5);
            _.map(users, 'name').should.not.include('Emily');
            done();
          });
        });
      });
    });

    it('should remove all children', function(done) {
      User.findOne({name: 'Carol'}, function(err, user) {
        should.not.exist(err);

        user.remove(function(err) {
          should.not.exist(err);

          User.find(function(err, users) {
            should.not.exist(err);

            users.length.should.equal(3);
            _.map(users, 'name').should.include('Adam').and.include('Bob');
            done();
          });
        });
      });
    });
  });

  function checkPaths(done) {
    User.find({}, function(err, users) {
      should.not.exist(err);

      var userPerId = {};
      users.forEach(function(user) {
        userPerId[user._id] = user;
      });

      users.forEach(function(user) {
        if (!user.parent) {
          return;
        }

        should.exist(userPerId[user.parent]);
        user.path.should.equal(userPerId[user.parent].path + '.' + user._id);
      });

      done();
    });
  }

  describe('moving documents', function() {
    it('should change children paths', function(done) {
      User.find({}, function(err, users) {
        should.not.exist(err);

        var names = {};
        users.forEach(function(user) {
          names[user.name] = user;
        });

        var carol = names['Carol'];
        var bob   = names['Bob'];

        carol.parent = bob;
        carol.save(function(err) {
          should.not.exist(err);
          checkPaths(done);
        });
      });
    });
  });

  describe('get children', function() {
    it('should return immediate children with filters', function(done) {
      User.findOne({name: 'Adam'}, function(err, adam) {
        should.not.exist(err);

        adam.getChildren({name: 'Bob'}, function(err, users) {
          should.not.exist(err);

          users.length.should.equal(1);
          _.map(users, 'name').should.include('Bob');
          done();
        });
      });
    });

    it('should return immediate children', function(done) {
      User.findOne({name: 'Adam'}, function(err, adam) {
        should.not.exist(err);

        adam.getChildren(function(err, users) {
          should.not.exist(err);

          users.length.should.equal(2);
          _.map(users, 'name').should.include('Bob').and.include('Carol');
          done();
        });
      });
    });

    it('should return recursive children', function(done) {
      User.findOne({'name': 'Carol'}, function(err, carol) {
        should.not.exist(err);

        carol.getChildren(true, function(err, users) {
          should.not.exist(err);

          users.length.should.equal(2);
          _.map(users, 'name').should.include('Dann').and.include('Emily');
          done();
        });
      });
    });

    it('should return children with only name and _id fields', function(done) {
      User.findOne({'name': 'Carol'}, function(err, carol) {
        should.not.exist(err);

        carol.getChildren({}, 'name', true, function(err, users) {
          should.not.exist(err);

          users.length.should.equal(2);
          users[0].should.not.have.own.property('parent');
          _.map(users, 'name').should.include('Dann').and.include('Emily');

          done();
        });
      });
    });

    it('should return children sorted on name', function(done) {
      User.findOne({'name': 'Carol'}, function(err, carol) {
        should.not.exist(err);

        carol.getChildren({}, null, {sort: {name: -1}}, true,
            function(err, users) {
              should.not.exist(err);

              users.length.should.equal(2);
              users[0].name.should.equal('Emily');
              _.map(users, 'name').should.include('Dann').and.include('Emily');

              done();
            });
      });
    });
  });

  describe('level virtual', function() {
    it('should equal the number of ancestors', function(done) {
      User.findOne({'name': 'Dann'}, function(err, dann) {
        should.not.exist(err);

        dann.level.should.equal(3);
        done();
      });
    });
  });

  describe('get ancestors', function() {

    it('should return ancestors', function(done) {
      User.findOne({'name': 'Dann'}, function(err, dann) {
        dann.getAncestors(function(err, ancestors) {
          should.not.exist(err);

          ancestors.length.should.equal(2);
          _.map(ancestors, 'name').should.include('Carol').and.include('Adam');
          done();
        });
      });
    });

    it('should return ancestors with only name and _id fields', function(done) {
      User.findOne({'name': 'Dann'}, function(err, dann) {
        dann.getAncestors({}, 'name', function(err, ancestors) {
          should.not.exist(err);

          ancestors.length.should.equal(2);
          ancestors[0].should.not.have.own.property('parent');
          ancestors[0].should.have.property('name');
          _.map(ancestors, 'name').should.include('Carol').and.include('Adam');
          done();
        });
      });
    });

    it('should return ancestors sorted on name and without wrappers',
        function(done) {
          User.findOne({'name': 'Dann'}, function(err, dann) {
            dann.getAncestors({}, null, {sort: {name: -1}, lean: 1},
                function(err, ancestors) {
                  should.not.exist(err);

                  ancestors.length.should.equal(2);
                  ancestors[0].name.should.equal('Carol');
                  should.not.exist(ancestors[0].getAncestors);
                  _.map(ancestors, 'name').should.include('Carol').and.include('Adam');
                  done();
                });
          });
        });
  });

  describe('get children tree', function() {
    it('should return complete children tree', function(done) {
      User.getChildrenTree(function(err, childrenTree) {
        should.not.exist(err);

        childrenTree.length.should.equal(2);

        var adamTree  = _.find(childrenTree, function(x) { return x.name === 'Adam';});
        var frankTree  = _.find(childrenTree, function(x) { return x.name === 'Frank';});
        var bobTree   = _.find(adamTree.children, function(x) { return x.name === 'Bob';});
        var carolTree = _.find(adamTree.children, function(x) { return x.name === 'Carol';});
        var danTree   = _.find(carolTree.children, function(x) { return x.name === 'Dann';});
        var emilyTree = _.find(danTree.children, function(x) { return x.name === 'Emily';});

        adamTree.children.length.should.equal(2);
        frankTree.children.length.should.equal(0);

        bobTree.children.length.should.equal(0);

        carolTree.children.length.should.equal(1);

        danTree.children.length.should.equal(1);
        danTree.children[0].name.should.equal('Emily');

        emilyTree.children.length.should.equal(0);
        done();
      });
    });

    it('should return adam\'s children tree', function(done) {
      User.findOne({'name': 'Adam'}, function(err, adam) {
        adam.getChildrenTree(function(err, childrenTree) {
          should.not.exist(err);

          var bobTree   = _.find(childrenTree, function(x) { return x.name === 'Bob';});
          var carolTree = _.find(childrenTree, function(x) { return x.name === 'Carol';});
          var danTree   = _.find(carolTree.children, function(x) { return x.name === 'Dann';});
          var emilyTree = _.find(danTree.children, function(x) { return x.name === 'Emily';});

          bobTree.children.length.should.equal(0);
          carolTree.children.length.should.equal(1);
          danTree.children.length.should.equal(1);
          danTree.children[0].name.should.equal('Emily');
          emilyTree.children.length.should.equal(0);

          done();
        });
      });
    });
  });
});
