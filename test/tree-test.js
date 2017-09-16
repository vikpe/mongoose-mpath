var mongoose = require('mongoose');
var _        = require('lodash');
var Async    = require('async');
var should   = require('chai').should();
var Tree     = require('../lib/tree');

mongoose.Promise = global.Promise;

describe('mongoose materialized path plugin', function() {
  // Utils
  var locationsToPathObject = function(locations) {
    return locations.reduce(function(result, location) {
      result[location.name] = location.path;
      return result;
    }, {});
  };

  // Mongoose
  var dbConnection;
  var Location;
  var LocationSchema = new mongoose.Schema({_id: String, name: String});

  LocationSchema.plugin(Tree, {
    idType: String,
    pathSeparator: '.',
    onDelete: 'REPARENT'
  });

  /* 
  Sample locations
  --------------------------
  africa
  europe 
    norway
    sweden 
      stockholm 
        globe     
  */
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

    // Create locations
    Location.remove({}, function(err) {
      should.not.exist(err);

      africa    = new Location({_id: 'af', name: 'Africa'});
      europe    = new Location({_id: 'eu', name: 'Europe'});
      norway    = new Location({_id: 'no', name: 'Norway', parent: europe});
      sweden    = new Location({_id: 'se', name: 'Sweden', parent: europe});
      stockholm = new Location({_id: 'sthlm', name: 'Stockholm', parent: sweden});
      globe     = new Location({_id: 'globe', name: 'Globe', parent: stockholm});

      Async.forEachSeries(
          [africa, europe, norway, sweden, stockholm, globe],
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

  describe('pre save middleware', function() {
    it('should set parent', function() {
      should.not.exist(africa.parent);
      should.not.exist(europe.parent);
      norway.parent.should.equal(europe._id);
      sweden.parent.should.equal(europe._id);
      stockholm.parent.should.equal(sweden._id);
      globe.parent.should.equal(stockholm._id);
    });

    it('should set path', function() {
      africa.path.should.equal('af');
      europe.path.should.equal('eu');
      norway.path.should.equal('eu.no');
      sweden.path.should.equal('eu.se');
      stockholm.path.should.equal('eu.se.sthlm');
      globe.path.should.equal('eu.se.sthlm.globe');
    });

    it('should update child paths', function(done) {
      sweden.parent = africa;
      sweden.save(function(error) {
        should.not.exist(error);

        Location.find({}, function(error, locations) {
          should.not.exist(error);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Norway': 'eu.no',
            'Sweden': 'af.se',
            'Stockholm': 'af.se.sthlm',
            'Globe': 'af.se.sthlm.globe'
          });

          done();
        });
      });
    });
  });

  describe('pre remove middleware', function() {
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

    it('should reparent children', function(done) {
      sweden.remove(function() {
        Location.find(function(err, locations) {
          should.not.exist(err);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Norway': 'eu.no',
            'Stockholm': 'eu.sthlm',
            'Globe': 'eu.sthlm.globe'
          });

          done();
        });
      });
    });
  });

  describe('virtual field "level"', function() {
    it('should equal the number of ancestors', function() {
      africa.level.should.equal(1);
      europe.level.should.equal(1);
      norway.level.should.equal(2);
      sweden.level.should.equal(2);
      stockholm.level.should.equal(3);
      globe.level.should.equal(4);
    });
  });

  describe('getImmidiateChildren()', function() {
    it('using default params', function(done) {
      var conditions = {};
      var fields     = null;
      var options    = {};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway', 'Sweden']);
        done();
      });
    });

    it('using conditions (object)', function(done) {
      var conditions = {name: 'Norway'};
      var fields     = null;
      var options    = {};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway']);
        done();
      });
    });

    it('using conditions ($query)', function(done) {
      var conditions = {$query: {name: 'Norway'}};
      var fields     = null;
      var options    = {};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway']);
        done();
      });
    });

    it('using fields', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {lean: true};

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'no'}, {_id: 'se'}]);
        done();
      });
    });

    it('using options (sorted)', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {
        sort: {name: -1},
        lean: true
      };

      europe.getImmidiateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'se'}, {_id: 'no'}]);
        done();
      });
    });
  });

  describe('getParent()', function() {
    it('should get the parent', function(done) {
      var fields  = 'name';
      var options = {lean: true};

      var expectedParents = [
        [europe, null],
        [norway, {_id: 'eu', name: 'Europe'}],
        [sweden, {_id: 'eu', name: 'Europe'}],
        [stockholm, {_id: 'se', name: 'Sweden'}],
        [globe, {_id: 'sthlm', name: 'Stockholm'}],
        [africa, null]
      ];

      Async.forEachSeries(
          expectedParents,
          function(arr, asyncDone) {
            var child          = arr[0];
            var expectedParent = arr[1];

            child
                .getParent(fields, options, function(error, parent) {
                  if (null === expectedParent) {
                    should.not.exist(parent);
                  }
                  else {
                    parent.should.eql(expectedParent);
                  }

                })
                .then(function() {
                  asyncDone();
                });
          },
          done
      );
    });
  });

  describe('getAncestors()', function() {
    it('using default params', function(done) {
      var conditions = {};
      var fields     = null;
      var options    = {};

      stockholm.getAncestors(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Europe', 'Sweden']);
        done();
      });
    });

    it('using conditions (plain object)', function(done) {
      var conditions = {name: 'Europe'};
      var fields     = null;
      var options    = {};

      stockholm.getAncestors(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Europe']);
        done();
      });
    });

    it('using conditions ($query)', function(done) {
      var conditions = {$query: {name: 'Europe'}};
      var fields     = null;
      var options    = {};

      stockholm.getAncestors(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Europe']);
        done();
      });
    });

    it('using fields', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {lean: true};

      stockholm.getAncestors(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'eu'}, {_id: 'se'}]);
        done();
      });
    });

    it('using options (sort)', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {
        sort: {name: -1},
        lean: true
      };

      stockholm.getAncestors(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'se'}, {_id: 'eu'}]);
        done();
      });
    });
  });
});
