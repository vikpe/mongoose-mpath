var Schema       = require('mongoose').Schema;
var streamWorker = require('stream-worker');

module.exports = exports = mpathPlugin;

function mpathPlugin(schema, options) {
  var onDelete = options && options.onDelete || 'REPARENT'; // or 'DELETE'
  var idType = options && options.idType || Schema.ObjectId;
  var pathSeparator = options && options.pathSeparator || '#';
  var pathSeparatorRegex = '[' + pathSeparator + ']';

  var streamWorkerOptions = {
    promises: false,
    concurrency: 5
  };

  schema.add({
    parent: {
      type: idType,
      set: function(value) {
        return ((value instanceof Object) && value._id) ? value._id : value;
      },
      index: true
    },
    path: {
      type: String,
      index: true
    }
  });

  schema.pre('save', function preSave(next) {
    var hasModifiedParent = this.isModified('parent');
    var pathUpdateIsRequired = (this.isNew || hasModifiedParent);

    if ( !pathUpdateIsRequired ) {
      return next();
    }

    var self = this;

    var updateChildPaths = function(pathToReplace, replacementPath) {
      var childConditions = {path: {'$regex': '^' + pathToReplace + pathSeparatorRegex}};
      var childStream = self.collection.find(childConditions).stream();

      var onStreamData = function(childDoc, done) {
        var newChildPath = replacementPath + childDoc.path.substr(pathToReplace.length);
        self.collection.update({_id: childDoc._id}, {$set: {path: newChildPath}}, done);
      };

      var onStreamClose = function(error) {
        return next(error);
      };

      streamWorker(childStream, onStreamData, streamWorkerOptions, onStreamClose);
    };

    var oldPath = self.path;

    if (this.parent) {
      this.collection.findOne({_id: this.parent}, function(error, parentDoc) {
        if (error) {
          return next(error);
        }

        var newPath = parentDoc.path + pathSeparator + self._id.toString();
        self.path   = newPath;

        if (hasModifiedParent) { // Rewrite child paths when parent is changed
          updateChildPaths(oldPath, newPath);
        }
        else {
          return next();
        }
      });
    }
    else {
      var newPath = self._id.toString();
      self.path   = newPath;

      if (hasModifiedParent) {
        updateChildPaths(oldPath, newPath);
      }
      else {
        return next();
      }
    }
  });

  schema.pre('remove', function preRemove(next) {
    if (!this.path) {
      return next();
    }

    if ('DELETE' === onDelete) {
      var deleteConditions = {path: {'$regex': '^' + this.path + pathSeparatorRegex}};
      this.collection.remove(deleteConditions, next);
    }
    else { // 'REPARENT'
      var parentOfDeletedDoc = this.parent;
      var childConditions    = {parent: this._id};
      var childCursor = this.model(this.constructor.modelName).find(childConditions).cursor();

      var onStreamData = function(childDoc, done) {
        childDoc.parent = parentOfDeletedDoc;
        childDoc.save(function(error) {
          if (error) {
            return next(error);
          }
          else {
            done();
          }
        });
      };

      var onStreamClose = function(error) {
        return next(error);
      };

      streamWorker(childCursor, onStreamData, streamWorkerOptions, onStreamClose);
    }
  });

  var getLevelByPath = function(path) {
    return path ? path.split(pathSeparator).length : 0;
  };

  schema.virtual('level').get(function virtualPropLevel() {
    return getLevelByPath(this.path);
  });

  schema.methods.getImmediateChildren = function getImmediateChildren(conditions, fields, options, callback) {
    conditions = conditions || {};
    fields     = fields || null;
    options    = options || {};

    if (conditions['$query']) {
      conditions['$query']['parent'] = this._id;
    }
    else {
      conditions['parent'] = this._id;
    }

    return this.model(this.constructor.modelName).find(conditions, fields, options, callback);
  };

  schema.methods.getAllChildren = function getAllChildren(conditions, fields, options, callback) {
    conditions = conditions || {};
    fields     = fields || null;
    options    = options || {};

    var pathConditions = {$regex: '^' + this.path + pathSeparatorRegex};

    if (conditions['$query']) {
      conditions['$query']['path'] = pathConditions;
    }
    else {
      conditions['path'] = pathConditions;
    }

    return this.model(this.constructor.modelName).find(conditions, fields, options, callback);
  };

  schema.methods.getParent = function getParent(fields, options, callback) {
    var conditions = {_id: this.parent};
    fields         = fields || null;
    options        = options || {};
    return this.model(this.constructor.modelName).findOne(conditions, fields, options, callback);
  };

  schema.methods.getAncestors = function getAncestors(conditions, fields, options, callback) {
    conditions = conditions || {};
    fields     = fields || null;
    options    = options || {};

    var ancestorIds = [];

    if (this.path) {
      ancestorIds = this.path.split(pathSeparator);
      ancestorIds.pop();
    }

    if (conditions['$query']) {
      conditions['$query']['_id'] = {$in: ancestorIds};
    }
    else {
      conditions['_id'] = {$in: ancestorIds};
    }

    return this.model(this.constructor.modelName).find(conditions, fields, options, callback);
  };

  schema.statics.getChildrenTree = function getChildrenTree(rootDoc, args, callback) {
    if ('function' === typeof(rootDoc)) {
      callback = rootDoc;
      rootDoc = null;
      args = {};
    }
    else if ('function' === typeof(args)) {
      callback = args;
      args = rootDoc;
      rootDoc = null;
    }

    if (!callback) {
      throw new Error('no callback defined when calling getChildrenTree');
    }

    var filters = args.filters || {};
    var fields = args.fields || null;
    var options = args.options || {};
    var minLevel = args.minLevel || 1;
    var populateStr = args.populate || '';

    options.lean = 1;

    // filters
    if (rootDoc) {
      filters.path = {$regex: '^' + rootDoc.path + pathSeparatorRegex};
    }

    // fields: Add path and parent in the result if not already specified
    if (fields) {
      if (fields instanceof Object) {
        if (!fields.hasOwnProperty('path')) {
          fields['path'] = 1;
        }
        if (!fields.hasOwnProperty('parent')) {
          fields['parent'] = 1;
        }
      }
      else {
        if (!fields.match(/path/)) {
          fields += ' path';
        }
        if (!fields.match(/parent/)) {
          fields += ' parent';
        }
      }
    }

    // options:sort , path sort is mandatory
    if (!options.sort) {
      options.sort = {};
    }
    options.sort.path = 1;

    return this.find(filters, fields, options)
      .populate(populateStr)
      .exec(function(error, results) {
        if (error) {
          return callback(error);
        }

        var createChildren = function createChildren(result, node, level) {
          if (level === minLevel) {
            node.children = [];

            return result.push(node);
          }

          var lastIndex = result.length - 1;
          var lastNode = result[lastIndex];

          if (lastNode) {
            createChildren(lastNode.children, node, level - 1);
          }
        };

        var finalResults = [];
        var rootLevel = 1;

        if (rootDoc) {
          rootLevel = getLevelByPath(rootDoc.path) + 1;
        }

        if (minLevel < rootLevel) {
          minLevel = rootLevel;
        }

        for (var key in results) {
          if (results.hasOwnProperty(key)) {
            var level = getLevelByPath(results[key].path);
            createChildren(finalResults, results[key], level);
          }
        }

        callback(error, finalResults);
      });
  };

  schema.methods.getChildrenTree = function(args, callback) {
    this.constructor.getChildrenTree(this, args, callback);
  };
}
