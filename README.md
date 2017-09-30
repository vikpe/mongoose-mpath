# Mongoose Materialized Path
[![Build Status](https://travis-ci.org/vikpe/mongoose-mpath.svg?branch=master)](https://travis-ci.org/vikpe/mongoose-mpath) [![Test Coverage](https://codeclimate.com/github/vikpe/mongoose-mpath/badges/coverage.svg)](https://codeclimate.com/github/vikpe/mongoose-mpath/coverage)

Mongoose plugin for tree hierarchy using the [materialized path pattern](https://docs.mongodb.com/manual/tutorial/model-tree-structures-with-materialized-paths/).

## Installation
```npm
npm install mongoose-mpath
```

## Setup

**Semantics**
```javascript
MySchema.plugin(MpathPlugin, [PLUGIN OPTIONS]);
```

**Plugin options**

```javascript
{
  pathSeparator: '#',              // String used to separate ids in path
  onDelete:      'REPARENT',       // 'REPARENT' or 'DELETE'
  idType:        Schema.ObjectId   // Type used for model id
}
```

**Example setup**
```javascript
var Mongoose = require('mongoose');
var MpathPlugin = require('mongoose-mpath');

var LocationSchema = new Mongoose.Schema({ name : String });
LocationSchema.plugin(MpathPlugin, {
  pathSeparator: '.'
});

var LocationModel = Mongoose.model('Location', LocationSchema);

var europe = new LocationModel({name: 'europe'});
var sweden = new LocationModel({name: 'sweden', parent: europe});
var stockholm = new LocationModel({name: 'stockholm', parent: sweden});

europe.save(function() {
  sweden.save(function() {
    stockholm.save();
  });
});
```

At this point in mongoDB you will have documents similar to
```
{
  "_id" : ObjectId("50136e40c78c4b9403000001"),
  "name" : "europe",
  "path" : "50136e40c78c4b9403000001"
}
{
  "_id" : ObjectId("50136e40c78c4b9403000002"),
  "name" : "sweden",
  "parent" : ObjectId("50136e40c78c4b9403000001"),
  "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002"
}
{
  "_id" : ObjectId("50136e40c78c4b9403000003"),
  "name" : "stockholm",
  "parent" : ObjectId("50136e40c78c4b9403000002"),
  "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002#50136e40c78c4b9403000003"
}
```

The path is used for recursive methods and is kept up to date by the plugin if the parent is changed.

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
(int) document.level
```

A Virtual field that equals to the level of a document in the hierarchy.

## Examples

Given the following document hierarchy:
```
africa
europe
 - norway
 - sweden
   -- stockholm
     --- globe
```


**getAncestors()**
```
europe.getAncestors()       // []
stockholm.getAncestors()    // [europe, sweden]
globe.getAncestors()        // [europe, sweden, stockholm]
```

**getAllChildren()**
```
europe.getAllChildren()       // [sweden, stockholm, globe]
stockholm.getAllChildren()    // [globe]
globe.getAllChildren()        // []
```

**getImmediateChildren()**
```
europe.getImmediateChildren()       // [norway, sweden]
stockholm.getImmediateChildren()    // [globe]
globe.getImmediateChildren()        // []
```

**getChildrenTree()**
```
sweden.getChildrenTree()

/*
{
  'id': 'se',
  'name': 'sweden',
  'parent': 'eu',
  'path': 'eu#se'
  'children': [
    {
      'id': 'sthlm',
      'name': 'sthlm',
      'parent': 'se',
      'path': 'eu#se#sthlm',
      'children': [
        {
          'id': 'globe',
          'name': 'globe',
          'parent': 'sthlm',
          'path': 'eu#se#sthlm#globe'
          'children': [],          
        }
      ],
    }
  ],
}
*/
```

**getParent()**
```
europe.getParent()       // (null)
stockholm.getParent()    // sweden
globe.getParent()        // stockholm
```

**level**
```
africa.level    // 1
sweden.level    // 2
globe.level     // 4
```

## Credits
This plugin is inspired by [swayf/mongoose-path-tree](https://github.com/swayf/mongoose-path-tree).
