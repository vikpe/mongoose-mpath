# Mongoose Materialized Path
[![Build Status](https://travis-ci.org/vikpe/mongoose-mpath.svg?branch=master)](https://travis-ci.org/vikpe/mongoose-mpath) [![Test Coverage](https://codeclimate.com/github/vikpe/mongoose-mpath/badges/coverage.svg)](https://codeclimate.com/github/vikpe/mongoose-mpath/coverage)

Mongoose plugin for tree hierarchy using the [materialized path pattern](https://docs.mongodb.com/manual/tutorial/model-tree-structures-with-materialized-paths/).

## Installation
```npm
npm install mongoose-mpath
```

## Setup

```
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
* [`Document.level()`](#level)

---

### level
`(virtual field) level`

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
