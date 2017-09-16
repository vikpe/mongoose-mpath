var mongoose = require('mongoose');
var _        = require('lodash');
var Async    = require('async');
var should   = require('chai').should();
var Tree     = require('../lib/tree');

mongoose.Promise = global.Promise;

describe('tree tests', function() {
  // Utils
  var locationsToPathObject = function(locations) {
    return locations.reduce(function(result, location) {
      result[location.name] = location.path;
      return result;
    }, {});
  };

  // Variables
  var pluginOptions = {
    idType: String,
    pathSeparator: '.',
    onDelete: 'REPARENT'
  };

  var Location;
  var LocationSchema = new mongoose.Schema({_id: String, name: String});
  LocationSchema.plugin(Tree, pluginOptions);

  var dbConnection;

  // Sample locations
  var africa;
  var europe;
  var sweden;
  var stockholm;
  var globe;
  var norway;

  // Set up the fixture
  beforeEach(function(done) {
    // Connect to database and setup model
    dbConnection = mongoose.createConnection('mongodb://localhost:27017/mongoose-path-tree', {useMongoClient: true});
    Location     = dbConnection.model('Location', LocationSchema);

    // Schema for tests
    Location.remove({}, function(err) {
      should.not.exist(err);

      africa    = new Location({_id: 'af', name: 'Africa'});
      europe    = new Location({_id: 'eu', name: 'Europe'});
      sweden    = new Location({_id: 'se', name: 'Sweden', parent: europe});
      stockholm = new Location({_id: 'sthlm', name: 'Stockholm', parent: sweden});
      globe     = new Location({_id: 'globe', name: 'Globe', parent: stockholm});
      norway    = new Location({_id: 'no', name: 'Norway', parent: europe});

      Async.forEachSeries(
          [europe, sweden, stockholm, globe, norway, africa],
          function(doc, asyncDone) {
            doc.save(asyncDone);
          },
          done
      );
    });
  });

  afterEach(function() {
    dbConnection.close();
  });

  describe('creating documents', function() {
    it('should set parent', function() {
      should.not.exist(africa.parent);
      should.not.exist(europe.parent);
      sweden.parent.should.equal(europe._id);
      stockholm.parent.should.equal(sweden._id);
      globe.parent.should.equal(stockholm._id);
      norway.parent.should.equal(europe._id);
    });

    it('should set path', function() {
      africa.path.should.equal('af');
      europe.path.should.equal('eu');
      sweden.path.should.equal('eu.se');
      stockholm.path.should.equal('eu.se.sthlm');
      globe.path.should.equal('eu.se.sthlm.globe');
      norway.path.should.equal('eu.no');
    });
  });

  describe('updating documents', function() {
    it('should change child paths', function(done) {
      sweden.parent = africa;
      sweden.save(function(error) {
        should.not.exist(error);

        Location.find({}, function(error, locations) {
          should.not.exist(error);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Sweden': 'af.se',
            'Stockholm': 'af.se.sthlm',
            'Globe': 'af.se.sthlm.globe',
            'Norway': 'eu.no'
          });

          done();
        });
      });
    });
  });

  describe('removing document', function() {
    it('should remove leaf nodes', function(done) {
      norway.remove(function() {
        Location.find({}, function(error, locations) {
          should.not.exist(error);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Sweden': 'eu.se',
            'Stockholm': 'eu.se.sthlm',
            'Globe': 'eu.se.sthlm.globe'
          });

          done();
        });
      });
    });

    it('should remove nodes and reparent children', function(done) {
      sweden.remove(function() {
        Location.find(function(err, locations) {
          should.not.exist(err);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Stockholm': 'eu.sthlm',
            'Globe': 'eu.sthlm.globe',
            'Norway': 'eu.no'
          });

          done();
        });
      });
    });
  });

  describe('level virtual', function() {
    it('should equal the number of ancestors', function() {
      africa.level.should.equal(1);
      europe.level.should.equal(1);
      sweden.level.should.equal(2);
      stockholm.level.should.equal(3);
      globe.level.should.equal(4);
      norway.level.should.equal(2);
    });
  });

  describe('get immediate children', function() {

    it('should return children', function(done) {
      var conditions = {};
      var fields     = null;
      var options    = {};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Sweden', 'Norway']);
        done();
      });
    });

    it('should return children with conditions', function(done) {
      var conditions = {name: 'Norway'};
      var fields     = null;
      var options    = {};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway']);
        done();
      });
    });

    it('should return children with fields', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {lean: true};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'se'}, {_id: 'no'}]);
        done();
      });
    });

    it('should return children with options (sorted)', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {
        sort: {name: 1},
        lean: true
      };

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'no'}, {_id: 'se'}]);
        done();
      });
    });
  });

  it('get parent', function(done) {
    var fields  = 'name';
    var options = {lean: true};

    var expectedParents = [
      [europe, null],
      [sweden, {_id: 'eu', name: 'Europe'}],
      [stockholm, {_id: 'se', name: 'Sweden'}],
      [globe, {_id: 'sthlm', name: 'Stockholm'}],
      [norway, {_id: 'eu', name: 'Europe'}],
      [africa, null]
    ];

    Async.forEachSeries(
        expectedParents,
        function(arr, asyncDone) {
          var child          = arr[0];
          var expectedParent = arr[1];

          child.getParent(fields, options, function(error, parent) {
            if (null === expectedParent) {
              should.not.exist(parent);
            }
            else {
              parent.should.eql(expectedParent);
            }

            asyncDone();
          });
        },
        done
    );
  });

  /*
  describe('get ancestors', function() {

    it('should return ancestors', function(done) {
      Location.findOne({'name': 'Dann'}, function(err, dann) {
        dann.getAncestors(function(err, ancestors) {
          should.not.exist(err);

          ancestors.length.should.equal(2);
          _.map(ancestors, 'name').should.include('Carol').and.include('Adam');
          done();
        });
      });
    });

    it('should return ancestors with only name and _id fields', function(done) {
      Location.findOne({'name': 'Dann'}, function(err, dann) {
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
          Location.findOne({'name': 'Dann'}, function(err, dann) {
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
      Location.getChildrenTree(function(err, childrenTree) {
        should.not.exist(err);

        childrenTree.length.should.equal(2);

        var adamTree  = _.find(childrenTree, function(x) { return x.name === 'Adam';});
        var frankTree = _.find(childrenTree, function(x) { return x.name === 'Frank';});
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
      Location.findOne({'name': 'Adam'}, function(err, adam) {
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
  */
});
