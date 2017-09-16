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

  schema.virtual('level').get(function virtualPropLevel() {
    return this.path ? this.path.split(pathSeparator).length : 0;
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
}
