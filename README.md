# Mongoose Materialized Path
[![Build Status](https://travis-ci.org/vikpe/mongoose-mpath.svg?branch=master)](https://travis-ci.org/vikpe/mongoose-mpath) [![Test Coverage](https://codeclimate.com/github/vikpe/mongoose-mpath/badges/coverage.svg)](https://codeclimate.com/github/vikpe/mongoose-mpath/coverage)

Mongoose plugin for tree hierarchy using the [materialized path pattern](https://docs.mongodb.com/manual/tutorial/model-tree-structures-with-materialized-paths/).

## Installation
```npm
npm install mongoose-mpath
```

## Setup

```javascript
var MpathPlugin = require('mongoose-mpath');
MySchema.plugin(MpathPlugin, [OPTIONS]);
```

**Options**

```javascript
{
  pathSeparator: '#',              // String used to separate ids in path
  onDelete:      'REPARENT',       // 'REPARENT' or 'DELETE'
  idType:        Schema.ObjectId   // Type used for model id
}
```

## Example
```javascript
var Mongoose = require('mongoose');
var MpathPlugin = require('mongoose-mpath');

var CategorySchema = new Mongoose.Schema({ name : String });
CategorySchema.plugin(MpathPlugin, {
  pathSeparator: '.'
});

var CategoryModel = Mongoose.model('Category', CategorySchema);
```

## API
* [`getAncestors()`](#getancestors)
* [`getAllChildren()`](#getallchildren)
* [`getImmediateChildren()`](#getimmediatechildren)
* [`getChildrenTree()`](#getchildrentree)
* [`getParent()`](#getparent)
* [`level`](#level)

### getAncestors()
```
document.getAncestors([conditions], [fields], [options], [callback])
```

Returns the ancestors of the document.

(see [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments)


### getAllChildren()
```
document.getAllChildren(conditions, [fields], [options], [callback])
```

Returns all children of the document (recursively).

(see [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments)


### getChildrenTree()
```
document.getChildrenTree(rootDocument, [args], [callback]) // as method
model.getChildrenTree([args], [callback]) // as static
```

Returns all children as a tree hierarchy (recursively).


### getImmediateChildren()
```
document.getImmediateChildren(conditions, [fields], [options], [callback])
```

Returns the immediate children of the document.

(see [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments)


### getParent()
```
document.getParent([fields], [options], [callback])
```

Returns the parent document of the document.

(see [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments)


### level
```
document.level
```

A Virtual field that equals to the level of a document in the hierarchy.

**Returns**

* `(int) level`

**Example**

Given the following hierarchy:
```
alpha
 - beta
  - gamma
```

it would return the following:
```
alpha.level // 1
beta.level  // 2
gamma.level // 3
```
