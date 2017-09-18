var Schema       = require('mongoose').Schema;
var streamWorker = require('stream-worker');

module.exports = exports = tree;

function tree(schema, options) {
  var pathSeparator      = options && options.pathSeparator || '#',
      wrapChildrenTree   = options && options.wrapChildrenTree,
      onDelete           = options && options.onDelete || 'REPARENT', //'DELETE'
      numWorkers         = options && options.numWorkers || 5,
      idType             = options && options.idType || Schema.ObjectId,
      pathSeparatorRegex = '[' + pathSeparator + ']';

  var streamWorkerOptions = {
    promises: false,
    concurrency: numWorkers
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

      this.collection.findOne({_id: this.parent}, function(err, parentDoc) {
        if (err) {
          return next(err);
        }

        var currentPath = self.path;
        self.path       = parentDoc.path + pathSeparator + self._id.toString();

        if (hasModifiedParent) { // Rewrite child paths when parent is changed
          var stream = self.collection.find({path: {'$regex': '^' + currentPath + pathSeparatorRegex}}).stream();

          var onStreamData = function(doc, done) {
            var newPath = self.path + doc.path.substr(currentPath.length);
            self.collection.update({_id: doc._id}, {$set: {path: newPath}}, done);
          };

          var onStreamClose = function(error) {
            return next(error);
          };

          streamWorker(stream, onStreamData, streamWorkerOptions, onStreamClose);
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
      var self   = this;
      var cursor = self.model(this.constructor.modelName).find({parent: this._id}).cursor();

      var onStreamData = function(doc, done) {
        doc.parent = self.parent;
        doc.save(function(error) {
          if (error) {
            return next(error);
          }
          done();
        });
      };

      var onStreamClose = function(error) {
        return next(error);
      };

      streamWorker(cursor, onStreamData, streamWorkerOptions, onStreamClose);
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

  schema.statics.getChildrenTree = function getChildrenTree(root, args, callback) {
    if ('function' === typeof(root)) {
      callback = root;
      root = null;
      args = {};
    }
    else if ('function' === typeof(args)) {
      callback = args;

      if ('model' in root) {
        args = {};
      }
      else {
        args = root;
        root = null;
      }
    }

    var filters = args.filters || {};
    var fields = args.fields || null;
    var options = args.options || {};
    var minLevel = args.minLevel || 1;
    var recursive = args.recursive !== undefined
        ? args.recursive
        : true;
    var allowEmptyChildren = args.allowEmptyChildren !== undefined
        ? args.allowEmptyChildren
        : true;

    if (!callback) {
      throw new Error('no callback defined when calling getChildrenTree');
    }

    // filters: Add recursive path filter or not
    if (recursive) {
      if (root) {
        filters.path = {$regex: '^' + root.path + pathSeparatorRegex};
      }

      if (null === filters.parent) {
        delete filters.parent;
      }
    }
    else {
      if (root) {
        filters.parent = root._id;
      }
      else {
        filters.parent = null;
      }
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

    if (null === options.lean) {
      options.lean = !wrapChildrenTree;
    }

    return this.find(filters, fields, options, function(err, results) {
      if (err) {
        return callback(err);
      }

      var createChildren = function createChildren(arr, node, level) {
        if (level === minLevel) {
          if (allowEmptyChildren) {
            node.children = [];
          }
          return arr.push(node);
        }

        var nextIndex = arr.length - 1;
        var myNode = arr[nextIndex];

        if (!myNode) {
          return [];
        }
        else {
          createChildren(myNode.children, node, level - 1);
        }
      };

      var finalResults = [];
      var rootLevel = 1;

      if (root) {
        rootLevel = getLevelByPath(root.path) + 1;
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

      callback(err, finalResults);
    });
  };

  schema.methods.getChildrenTree = function(args, next) {
    this.constructor.getChildrenTree(this, args, next);
  };
}
