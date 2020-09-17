const Schema = require('mongoose').Schema;
const streamWorker = require('stream-worker');
const _orderBy = require('lodash/orderBy');

const mpathUtil = {};

mpathUtil.getLevelByPathAndSeparator = (path, separator) =>
  path ? path.split(separator).length : 1;

mpathUtil.mongoSortToLodashSort = (mongoSortObj) => {
  const lodashSortObj = {
    keys: [],
    orders: [],
  };

  for (let key in mongoSortObj) {
    if (mongoSortObj.hasOwnProperty(key)) {
      let sortOrder = mongoSortObj[key] === -1 ? 'desc' : 'asc';
      lodashSortObj.keys.push(key);
      lodashSortObj.orders.push(sortOrder);
    }
  }

  return lodashSortObj;
};

mpathUtil.listToTree = (list, sort) => {
  let nodeMap = {};
  let currentNode;
  let rootNodes = [];
  let index;
  let lodashSort = mpathUtil.mongoSortToLodashSort(sort);
  const shouldSort = lodashSort.keys.length > 0;

  for (index = 0; index < list.length; index += 1) {
    currentNode = list[index];
    currentNode.children = [];
    nodeMap[currentNode._id] = index;

    const hasParentInMap = nodeMap.hasOwnProperty(currentNode.parent);

    if (hasParentInMap) {
      list[nodeMap[currentNode.parent]].children.push(currentNode);

      if (shouldSort) {
        list[nodeMap[currentNode.parent]].children = _orderBy(
          list[nodeMap[currentNode.parent]].children,
          lodashSort.keys,
          lodashSort.orders
        );
      }
    } else {
      rootNodes.push(currentNode);
    }
  }

  if (shouldSort) {
    rootNodes = _orderBy(rootNodes, lodashSort.keys, lodashSort.orders);
  }

  return rootNodes;
};

/**
 * Main plugin method
 * @param  {Schema} schema  Mongoose Schema
 * @param  {Object} options [description]
 */
function mpathPlugin(schema, options) {
  const onDelete = (options && options.onDelete) || 'REPARENT'; // or 'DELETE'
  const idType = (options && options.idType) || Schema.ObjectId;
  const pathSeparator = (options && options.pathSeparator) || '#';
  const pathSeparatorRegex = '[' + pathSeparator + ']';

  const streamWorkerOptions = {
    promises: false,
    concurrency: 5,
  };

  schema.add({
    parent: {
      index: true,
      set: (value) =>
        value instanceof Object && value._id ? value._id : value,
      type: idType,
    },
    path: {
      index: true,
      type: String,
    },
    children: [],
  });

  /**
   * Mongoose schema pre save hook
   * @param  {Function} next [description]
   */
  schema.pre('save', function preSave(next) {
    const hasModifiedParent = this.isModified('parent');
    const pathUpdateIsRequired = this.isNew || hasModifiedParent;

    if (!pathUpdateIsRequired) {
      return next();
    }

    const self = this;

    const updateChildPaths = (pathToReplace, replacementPath) => {
      const childConditions = {
        path: { $regex: '^' + pathToReplace + pathSeparatorRegex },
      };

      const childStream = self.collection.find(childConditions).stream();

      const onStreamData = (childDoc, done) => {
        const newChildPath =
          replacementPath + childDoc.path.substr(pathToReplace.length);

        self.collection
          .updateMany({ _id: childDoc._id }, { $set: { path: newChildPath } })
          .then(() => done());
      };

      const onStreamClose = (ex) => next(ex);

      streamWorker(
        childStream,
        onStreamData,
        streamWorkerOptions,
        onStreamClose
      );
    };

    const oldPath = self.path;

    if (this.parent) {
      this.collection
        .findOne({ _id: this.parent })
        .then((parentDoc) => {
          const newPath = parentDoc.path + pathSeparator + self._id.toString();
          self.path = newPath;

          if (hasModifiedParent) {
            // Rewrite child paths when parent is changed
            updateChildPaths(oldPath, newPath);
          } else {
            return next();
          }
        })
        .catch((ex) => next(ex));
    } else {
      const newPath = self._id.toString();
      self.path = newPath;

      if (hasModifiedParent) {
        updateChildPaths(oldPath, newPath);
      } else {
        return next();
      }
    }
  });

  /**
   * Mongoose schema pre remove hook
   * @param  {Function} next [description]
   */
  schema.pre('remove', function preRemove(next) {
    if (!this.path) {
      return next();
    }

    if ('DELETE' === onDelete) {
      const deleteConditions = {
        path: { $regex: '^' + this.path + pathSeparatorRegex },
      };
      this.collection.deleteMany(deleteConditions, next);
    } else {
      // 'REPARENT'
      const parentOfDeletedDoc = this.parent;
      const childConditions = { parent: this._id };
      const childCursor = this.model(this.constructor.modelName)
        .find(childConditions)
        .cursor();

      const onStreamData = (childDoc, done) => {
        childDoc.parent = parentOfDeletedDoc;

        childDoc
          .save()
          .then(() => done())
          .catch((ex) => next(ex));
      };

      const onStreamClose = (ex) => next(ex);

      streamWorker(
        childCursor,
        onStreamData,
        streamWorkerOptions,
        onStreamClose
      );
    }
  });

  schema.virtual('level').get(function virtualPropLevel() {
    return mpathUtil.getLevelByPathAndSeparator(this.path, pathSeparator);
  });

  schema.methods.getImmediateChildren = function getImmediateChildren(
    conditions,
    fields,
    options
  ) {
    conditions = conditions || {};
    fields = fields || null;
    options = options || {};

    if (conditions['$query']) {
      conditions['$query']['parent'] = this._id;
    } else {
      conditions['parent'] = this._id;
    }

    return this.model(this.constructor.modelName).find(
      conditions,
      fields,
      options
    );
  };

  schema.methods.getAllChildren = function getAllChildren(
    conditions,
    fields,
    options
  ) {
    conditions = conditions || {};
    fields = fields || null;
    options = options || {};

    const pathConditions = { $regex: '^' + this.path + pathSeparatorRegex };

    if (conditions['$query']) {
      conditions['$query']['path'] = pathConditions;
    } else {
      conditions['path'] = pathConditions;
    }

    return this.model(this.constructor.modelName).find(
      conditions,
      fields,
      options
    );
  };

  /**
   * Get parent document
   * @param  {String} fields  [description]
   * @param  {Object} options [description]
   * @return {Prromise.<Mongoose.document>}         [description]
   */
  schema.methods.getParent = function getParent(fields, options) {
    const conditions = { _id: this.parent };

    fields = fields || null;
    options = options || {};

    return this.model(this.constructor.modelName).findOne(
      conditions,
      fields,
      options
    );
  };

  schema.methods.getAncestors = function getAncestors(
    conditions,
    fields,
    options
  ) {
    conditions = conditions || {};
    fields = fields || null;
    options = options || {};

    let ancestorIds = [];

    if (this.path) {
      ancestorIds = this.path.split(pathSeparator);
      ancestorIds.pop();
    }

    if (conditions['$query']) {
      conditions['$query']['_id'] = { $in: ancestorIds };
    } else {
      conditions['_id'] = { $in: ancestorIds };
    }

    return this.model(this.constructor.modelName).find(
      conditions,
      fields,
      options
    );
  };

  /**
   * Returns tree of child documents
   * @param  {Object} args [description]
   * @return {Promise.<Object>}      [description]
   */
  schema.statics.getChildrenTree = function getChildrenTree(args) {
    const rootDoc = args && args.rootDoc ? args.rootDoc : null;
    let fields = args && args.fields ? args.fields : null;
    let filters = args && args.filters ? args.filters : {};
    let minLevel = args && args.minLevel ? args.minLevel : 1;
    let maxLevel = args && args.maxLevel ? args.maxLevel : 9999;
    let options = args && args.options ? args.options : {};
    let populateStr = args && args.populate ? args.populate : '';

    // filters
    if (rootDoc) {
      filters.path = { $regex: '^' + rootDoc.path + pathSeparator };
    }

    // fields
    // include 'path' and 'parent' if not already included
    if (fields) {
      if (fields instanceof Object) {
        if (!fields.hasOwnProperty('path')) {
          fields['path'] = 1;
        }
        if (!fields.hasOwnProperty('parent')) {
          fields['parent'] = 1;
        }
      } else {
        if (!fields.match(/path/)) {
          fields += ' path';
        }
        if (!fields.match(/parent/)) {
          fields += ' parent';
        }
      }
    }

    // options:sort
    // passed options.sort is applied after entries are fetched from database
    let postSortObj = {};

    if (options.sort) {
      postSortObj = options.sort;
    }

    options.sort = { path: 1 };

    return this.find(filters, fields, options)
      .populate(populateStr)
      .then((result) =>
        result.filter((node) => {
          const level = mpathUtil.getLevelByPathAndSeparator(
            node.path,
            pathSeparator
          );
          return level >= minLevel && level <= maxLevel;
        })
      )
      .then((result) => mpathUtil.listToTree(result, postSortObj))
      .catch((err) => console.error(err));
  };

  /**
   * Static method of getChildrenTree schema
   * @param  {Object} args [description]
   * @return {Promise.<Mongoose.document>}      [description]
   */
  schema.methods.getChildrenTree = function (args) {
    args.rootDoc = this;

    return this.constructor.getChildrenTree(args);
  };
}

module.exports = exports = mpathPlugin;
module.exports.util = mpathUtil;
