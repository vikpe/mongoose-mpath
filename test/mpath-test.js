var mongoose    = require('mongoose');
var _           = require('lodash');
var Async       = require('async');
var should      = require('chai').should();
var sinon       = require('sinon');
var MpathPlugin = require('./../lib/mpath');
require('sinon-mongoose');

mongoose.Promise = global.Promise;

describe('mpath plugin', function() {
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

  LocationSchema.plugin(MpathPlugin, {
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

  var createLocations = function(done) {
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
  };

  // Set up the fixture
  beforeEach(function(done) {
    // Connect to database and setup model
    dbConnection = mongoose.createConnection('mongodb://localhost:27017/mongoose-path-tree', {useMongoClient: true});
    Location     = dbConnection.model('Location', LocationSchema);
    createLocations(done);
  });

  afterEach(function() {
    dbConnection.close();
  });

  describe('setup', function() {
    it('should add fields to schema (default options)', function() {
      var DefaultLocationSchema = new mongoose.Schema({name: String});
      DefaultLocationSchema.plugin(MpathPlugin);

      var LocationModel = dbConnection.model('SomeLocation', DefaultLocationSchema);
      var schemaPaths   = LocationModel.schema.paths;

      should.exist(schemaPaths.parent);
      schemaPaths.parent.options.type.should.eql(mongoose.Schema.ObjectId);
      should.exist(schemaPaths.path);
    });

    it('should add fields to schema (custom options)', function(done) {
      var randomId = function() {
        return _.shuffle(_.range(0, 9)).join('').substr(0, 3);
      };

      var CustomLocationSchema = new mongoose.Schema({
        _id: {type: String, default: randomId},
        name: String
      });

      var pluginOptions = {
        idType: String,
        pathSeparator: '.'
      };

      CustomLocationSchema.plugin(MpathPlugin, pluginOptions);

      var CustomLocationModel = dbConnection.model('SomeLocation', CustomLocationSchema);
      var schemaPaths         = CustomLocationModel.schema.paths;

      // check parent type
      schemaPaths.parent.options.type.should.eql(String);

      // check path separator
      var parentLocation = new CustomLocationModel({name: 'Super City'});
      var childLocation  = new CustomLocationModel({name: 'Sub City', parent: parentLocation});
	  
	  parentLocation.save(function() {
		  childLocation.save(function() {
			var expectedPath = parentLocation._id.toString() + '.' + childLocation._id.toString();
            childLocation.path.should.equal(expectedPath);

            done();
		  });
	  });
    });
  });

  describe('pre save middleware', function() {
    it('should not perform any operations when document isn\'t new or hasn\'t changed parent', function(done) {
      sinon.spy(sweden.collection, 'findOne');
      sinon.spy(sweden.collection, 'update');
      var pathBeforeSave = sweden.path;

      sweden.save(function() {
        sweden.path.should.equal(pathBeforeSave);
        sinon.assert.notCalled(sweden.collection.findOne);
        sinon.assert.notCalled(sweden.collection.update);
        done();
      })
    });

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
    it('should not reparent/delete children when path is undefined', function(done) {
      sweden.path = undefined;
      sweden.remove(function() {

        Location.find({}, function(error, locations) {
          should.not.exist(error);

          var pathObject = locationsToPathObject(locations);
          pathObject.should.eql({
            'Africa': 'af',
            'Europe': 'eu',
            'Norway': 'eu.no',
            'Stockholm': 'eu.se.sthlm',
            'Globe': 'eu.se.sthlm.globe'
          });

          done();
        });
      });
    });

    describe('using onDelete="REPARENT" (default)', function() {
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

      it('should reparent when new parent is defined', function(done) {
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

      it('should reparent when new parent is undefined', function(done) {
        europe.remove(function() {
          Location.find(function(err, locations) {
            should.not.exist(err);

            var pathObject = locationsToPathObject(locations);
            pathObject.should.eql({
              'Africa': 'af',
              'Norway': 'no',
              'Sweden': 'se',
              'Stockholm': 'se.sthlm',
              'Globe': 'se.sthlm.globe'
            });

            done();
          });
        });
      });
    });

    describe('using onDelete="DELETE"', function() {
      beforeEach(function(done) {
        // re-setup schema, model, database
        dbConnection.close();

        LocationSchema = new mongoose.Schema({_id: String, name: String});
        LocationSchema.plugin(MpathPlugin, {
          idType: String,
          pathSeparator: '.',
          onDelete: 'DELETE' // <- updated plugin option
        });

        dbConnection = mongoose.createConnection('mongodb://localhost:27017/mongoose-path-tree', {useMongoClient: true});
        Location     = dbConnection.model('Location', LocationSchema);
        createLocations(done);
      });

      it('should delete itself and all children', function(done) {
        sweden.remove(function() {
          Location.find({}, function(error, locations) {
            should.not.exist(error);

            var pathObject = locationsToPathObject(locations);
            pathObject.should.eql({
              'Africa': 'af',
              'Europe': 'eu',
              'Norway': 'eu.no'
            });

            done();
          });
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

  describe('getImmediateChildren()', function() {
    it('using default params', function(done) {
      var conditions = {};
      var fields     = null;
      var options    = {};

      europe.getImmediateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway', 'Sweden']);
        done();
      });
    });

    it('using conditions (object)', function(done) {
      var conditions = {name: 'Norway'};
      var fields     = null;
      var options    = {};

      europe.getImmediateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway']);
        done();
      });
    });

    it('using conditions ($query)', function(done) {
      var conditions = {$query: {name: 'Norway'}};
      var fields     = null;
      var options    = {};

      europe.getImmediateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway']);
        done();
      });
    });

    it('using fields', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {lean: true};

      europe.getImmediateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'no'}, {_id: 'se'}]);
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

      europe.getImmediateChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'se'}, {_id: 'no'}]);
        done();
      });
    });
  });

  describe('getAllChildren()', function() {
    it('using default params', function(done) {
      var conditions = {};
      var fields     = null;
      var options    = {};

      europe.getAllChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Norway', 'Sweden', 'Stockholm', 'Globe']);
        done();
      });
    });

    it('using conditions (object)', function(done) {
      var conditions = {name: 'Stockholm'};
      var fields     = null;
      var options    = {};

      europe.getAllChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Stockholm']);
        done();
      });
    });

    it('using conditions ($query)', function(done) {
      var conditions = {$query: {name: 'Stockholm'}};
      var fields     = null;
      var options    = {};

      europe.getAllChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        _.map(locations, 'name').should.eql(['Stockholm']);
        done();
      });
    });

    it('using fields', function(done) {
      var conditions = {};
      var fields     = '_id';
      var options    = {lean: true};

      europe.getAllChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'no'}, {_id: 'se'}, {_id: 'sthlm'}, {_id: 'globe'}]);
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

      europe.getAllChildren(conditions, fields, options, function(error, locations) {
        should.not.exist(error);
        locations.should.eql([{_id: 'se'}, {_id: 'sthlm'}, {_id: 'no'}, {_id: 'globe'}]);
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

  describe('getChildrenTree()', function() {
    it('should fail when no callback is provided', function() {
      var testFunc = function() {
        Location.getChildrenTree();
      };

      should.throw(testFunc, 'no callback defined when calling getChildrenTree');
    });

    it('should handle find error', function(done) {
      var LocationMock = sinon.mock(Location);
      var errorMessage = 'An error occured';

      LocationMock
          .expects('find')
          .chain('populate').withArgs('')
          .chain('exec')
          .yields(errorMessage);

      var args = {};

      sweden.getChildrenTree(args, function(error) {
        LocationMock.verify();
        LocationMock.restore();

        error.should.equal(errorMessage);
        done();
      });
    });

    it('static method - no args', function(done) {
      var expectedTree = [
        {
          '__v': 0,
          '_id': 'af',
          'children': [],
          'name': 'Africa',
          'path': 'af'
        },
        {
          '__v': 0,
          '_id': 'eu',
          'children': [
            {
              '__v': 0,
              '_id': 'no',
              'children': [],
              'name': 'Norway',
              'parent': 'eu',
              'path': 'eu.no'
            },
            {
              '__v': 0,
              '_id': 'se',
              'children': [
                {
                  '__v': 0,
                  '_id': 'sthlm',
                  'children': [
                    {
                      '__v': 0,
                      '_id': 'globe',
                      'children': [],
                      'name': 'Globe',
                      'parent': 'sthlm',
                      'path': 'eu.se.sthlm.globe'
                    }
                  ],
                  'name': 'Stockholm',
                  'parent': 'se',
                  'path': 'eu.se.sthlm'
                }
              ],
              'name': 'Sweden',
              'parent': 'eu',
              'path': 'eu.se'
            }
          ],
          'name': 'Europe',
          'path': 'eu'
        }
      ];

      Location.getChildrenTree(function(error, locationTree) {
        should.not.exist(error);
        locationTree.should.eql(expectedTree);
        done();
      });
    });

    it('static method - args', function(done) {
      var args = {
        fields: '_id name parent path'
      };

      var expectedTree = [
        {
          '_id': 'af',
          'children': [],
          'name': 'Africa',
          'path': 'af'
        },
        {
          '_id': 'eu',
          'children': [
            {
              '_id': 'no',
              'children': [],
              'name': 'Norway',
              'parent': 'eu',
              'path': 'eu.no'
            },
            {
              '_id': 'se',
              'children': [
                {
                  '_id': 'sthlm',
                  'children': [
                    {
                      '_id': 'globe',
                      'children': [],
                      'name': 'Globe',
                      'parent': 'sthlm',
                      'path': 'eu.se.sthlm.globe'
                    }
                  ],
                  'name': 'Stockholm',
                  'parent': 'se',
                  'path': 'eu.se.sthlm'
                }
              ],
              'name': 'Sweden',
              'parent': 'eu',
              'path': 'eu.se'
            }
          ],
          'name': 'Europe',
          'path': 'eu'
        }
      ];

      Location.getChildrenTree(args, function(error, locationTree) {
        should.not.exist(error);
        locationTree.should.eql(expectedTree);
        done();
      });
    });

    it('includes path and parent fields', function(done) {
      var args = {
        fields: '_id name'
      };

      var expectedTree = [
        {
          '_id': 'sthlm',
          'children': [
            {
              '_id': 'globe',
              'children': [],
              'name': 'Globe',
              'parent': 'sthlm',
              'path': 'eu.se.sthlm.globe'
            }
          ],
          'name': 'Stockholm',
          'parent': 'se',
          'path': 'eu.se.sthlm'
        }
      ];

      sweden.getChildrenTree(args, function(error, locationTree) {
        should.not.exist(error);
        locationTree.should.eql(expectedTree);
        done();
      });
    });

    it('fields as object', function(done) {
      var args = {
        fields: {_id: 1, name: 1}
      };

      var expectedTree = [
        {
          '_id': 'sthlm',
          'children': [
            {
              '_id': 'globe',
              'children': [],
              'name': 'Globe',
              'parent': 'sthlm',
              'path': 'eu.se.sthlm.globe'
            }
          ],
          'name': 'Stockholm',
          'parent': 'se',
          'path': 'eu.se.sthlm'
        }
      ];

      sweden.getChildrenTree(args, function(error, locationTree) {
        should.not.exist(error);
        locationTree.should.eql(expectedTree);
        done();
      });
    });
  });
});
