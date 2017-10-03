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

    if (this.isNew || hasModifiedParent) {
      if (!this.parent) {
        this.path = this._id.toString();
        return next();
      }

      var self = this;

      this.collection.findOne({_id: this.parent}, function(error, parentDoc) {
        if (error) {
          return next(error);
        }

        var oldPath = self.path;
        var newPath = parentDoc.path + pathSeparator + self._id.toString();

        self.path = newPath;

        if (hasModifiedParent) { // Rewrite child paths when parent is changed
          var childRegex = '^' + oldPath + pathSeparatorRegex;
          var childStream = self.collection.find({path: {'$regex': childRegex}}).stream();

          var onStreamData = function(childDoc, done) {
            var newChildPath = newPath + childDoc.path.substr(oldPath.length);
            self.collection.update({_id: childDoc._id}, {$set: {path: newChildPath}}, done);
          };

          var onStreamClose = function(error) {
            return next(error);
          };

          streamWorker(childStream, onStreamData, streamWorkerOptions, onStreamClose);
        }
        else {
          return next();
        }
      });
    }
    else {
      return next();
    }
  });

  schema.pre('remove', function preRemove(next) {
    if (!this.path) {
      return next();
    }

    if ('DELETE' === onDelete) {
      this.collection.remove({path: {'$regex': '^' + this.path + pathSeparatorRegex}}, next);
    }
    else { // 'REPARENT'
      var self        = this;
      var childCursor = self.model(this.constructor.modelName).find({parent: this._id}).cursor();

      var onStreamData = function(childDoc, done) {
        childDoc.parent = self.parent;
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
