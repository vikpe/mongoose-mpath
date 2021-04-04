# Mongoose Materialized Path [![test](https://github.com/vikpe/mongoose-mpath/workflows/test/badge.svg)](https://github.com/vikpe/mongoose-mpath/actions?query=workflow%3Atest) [![codecov](https://codecov.io/gh/vikpe/mongoose-mpath/branch/master/graph/badge.svg)](https://codecov.io/gh/vikpe/mongoose-mpath)
> Mongoose plugin for tree hierarchy using the [materialized path pattern](https://docs.mongodb.com/manual/tutorial/model-tree-structures-with-materialized-paths/).

## Installation
```npm
npm install mongoose-mpath
```

## Setup
> **Important note**
>
> This plugins adds `parent`, `path` and `children` fields to the schema. You should not define them in the schema which the plugin is enabled on.

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
import Mongoose from 'mongoose';
import MpathPlugin from 'mongoose-mpath';

const LocationSchema = new Mongoose.Schema({name: String});
LocationSchema.plugin(MpathPlugin);

const LocationModel = Mongoose.model('Location', LocationSchema);

const europe = new LocationModel({name: 'europe'});
const sweden = new LocationModel({name: 'sweden', parent: europe});
const stockholm = new LocationModel({name: 'stockholm', parent: sweden});

await europe.save();
await sweden.save();
await stockholm.save();
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

The `path` is used for recursive methods and is kept up to date by the plugin if the `parent` is changed.

## API
* [`getAncestors()`](#getancestors)
* [`getAllChildren()`](#getallchildren)
* [`getImmediateChildren()`](#getimmediatechildren)
* [`getChildrenTree()`](#getchildrentree)
* [`getParent()`](#getparent)
* [`level`](#level)

All examples below are based on the following document hierarchy:
```
africa
europe
 - norway
 - sweden
   -- stockholm
     --- skansen
```

### getAncestors()
Returns ancestors of a document. Returns a promise.

**Signature**
```
document.getAncestors(conditions, [fields], [options])
```

**Arguments**
* See offical docs on [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments.

**Example**
```javascript
const ancestors = await stockholm.getAncestors({});    // (Array) [europe, sweden]
```

### getAllChildren()
Returns all children of a document. Returns a promise.

**Signature**
```
document.getAllChildren(conditions, [fields], [options])
```

**Arguments**
* See offical docs on [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments.

**Example**
```javascript
const children = await sweden.getAllChildren({});       // (Array) [stockholm, skansen]
const children = await stockholm.getAllChildren({});    // (Array) [skansen]
```

### getChildrenTree()
Returns all children of a document formatted as a tree hierarchy. Returns a promise.

**Signature**
```
document.getChildrenTree([args])    // as method
model.getChildrenTree([args])       // as static
```

**Arguments**
* (Object) `args`
    ```
    {
        (Object) filters: {},            // mongoose query filters
        (Object|String) fields: null,    // mongoose query fields (null equals all fields)
        (Object) options: {},            // mongoose query options
        (String) populate: '',           // string to passed to populate()
        (int) minLevel: 1,               // minimum level to include
        (int) maxLevel: 9999,            // maximum level to include
        (Mongoose.document) rootDoc      // mongoose document
    }
    ```

    Example
    ```javascript
    const args = {
      filters: {author: 'vikpe'},
      fields: '_id name',
      options: {sort: 'name'},
      populate: 'repos',
      minLevel: 2,
      maxLevel: 4
    }
    ```

**Example**
```javascript
const tree = await sweden.getChildrenTree({});
// tree is an array similar to
/*
[
  {
    'name': 'sthlm',
    'children': [
      {
        'name': 'skansen',
        'children': [],          
      }
    ],
  }
]
*/
```

### getImmediateChildren()
Returns immediate children of a document. Returns a promise.

**Signature**
```
document.getImmediateChildren(conditions, [fields], [options])
```

**Arguments**
* See offical docs on [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments.

**Example**
```javascript
const children = await europe.getImmediateChildren({});    // (Array) [norway, sweden]
const children = await sweden.getImmediateChildren({});    // (Array) [stockholm]
```

### getParent()
Returns parent of a document.

**Signature**
```
document.getParent([fields], [options])
```

**Arguments**
* See offical docs on [model.find()](http://mongoosejs.com/docs/api.html#model_Model.find) for description of arguments.

**Example**
```javascript
const parent = await sweden.getParent();       // (Object) europe
const parent = await stockholm.getParent();    // (Object) sweden
```

### level
A Virtual field that equals to the level of a document in the hierarchy.

**Signature**
```
(Number) document.level
```

**Example**
```
africa.level    // 1
sweden.level    // 2
skansen.level   // 4
```

### children
Placeholder variable populated when calling `.getChildrenTree()`.


## More examples

Given the following document hierarchy:
```
africa
europe
 - norway
 - sweden
   -- stockholm
     --- skansen
```


**getAncestors()**
```
europe.getAncestors()       // (Array) []
stockholm.getAncestors()    // (Array) [europe, sweden]
skansen.getAncestors()      // (Array) [europe, sweden, stockholm]
```

**getAllChildren()**
```
europe.getAllChildren()       // (Array) [sweden, stockholm, skansen]
stockholm.getAllChildren()    // (Array) [skansen]
skansen.getAllChildren()      // (Array) []
```

**getImmediateChildren()**
```
europe.getImmediateChildren()       // (Array) [norway, sweden]
stockholm.getImmediateChildren()    // (Array) [skansen]
skansen.getImmediateChildren()      // (Array) []
```

**getChildrenTree()**
```
europe.getChildrenTree()

/*
[
  {
    'name': 'norway',
    'children': []
  },
  {
    'name': 'sweden',
    'children': [
        {
          'name': 'sthlm',
          'children': [
            {
              'name': 'skansen',
              'children': []          
            }
          ],
        }
    ]
   }  
]
*/


sweden.getChildrenTree()

/*
[
  {
    'name': 'sthlm',
    'children': [
      {
        'name': 'skansen',
        'children': [],          
      }
    ],
  }
]
*/
```

**getParent()**
```
europe.getParent()       // (null)
stockholm.getParent()    // (Object) sweden
skansen.getParent()      // (Object) stockholm
```

**level**
```
africa.level       // (Number) 1
europe.level       // (Number) 1
norway.level       // (Number) 2
sweden.level       // (Number) 2
stockholm.level    // (Number) 3
skansen.level      // (Number) 4
```

## Development
Feedback and pull requests are most welcome!

1. `npm install mongoose-mpath`
2. [Download and install MongoDB (Community Server)](https://www.mongodb.com/download-center#community).
3. Start MongoDB: `mongod`
3. Run tests: `npm run test`

## Credits
This plugin is inspired by `mongoose-path-tree` by [swayf](https://github.com/swayf).
