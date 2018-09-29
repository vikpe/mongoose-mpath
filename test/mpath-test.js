import _ from "lodash";
import Async from "async";
import chai from "chai";
import mongoose from "mongoose";
import MpathPlugin from "./../lib/mpath";
import sinon from "sinon";
require("sinon-mongoose");

const should = chai.should();

mongoose.Promise = global.Promise;
mongoose.set("useFindAndModify", false);
mongoose.set("useCreateIndex", true);

describe("mpath plugin", () => {
  // Utils
  const locationsToPathObject = locations =>
    locations.reduce((result, location) => {
      result[location.name] = location.path;
      return result;
    }, {});

  // Mongoose
  let dbConnection;
  let Location;
  let LocationSchema = new mongoose.Schema({ _id: String, name: String });

  LocationSchema.plugin(MpathPlugin, {
    idType: String,
    pathSeparator: ".",
    onDelete: "REPARENT"
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

  let africa;
  let europe;
  let sweden;
  let stockholm;
  let globe;
  let norway;

  const createLocations = async () => {
    africa = new Location({ _id: "af", name: "Africa" });
    europe = new Location({ _id: "eu", name: "Europe" });
    norway = new Location({ _id: "no", name: "Norway", parent: europe });
    sweden = new Location({ _id: "se", name: "Sweden", parent: europe });
    stockholm = new Location({
      _id: "sthlm",
      name: "Stockholm",
      parent: sweden
    });
    globe = new Location({ _id: "globe", name: "Globe", parent: stockholm });

    await Location.deleteMany();
    await africa.save();
    await europe.save();
    await norway.save();
    await sweden.save();
    await stockholm.save();
    await globe.save();
  };

  // Set up the fixture
  before(async () => {
    dbConnection = await mongoose.connect(
      "mongodb://localhost:27017/mongoose-path-tree",
      {
        connectTimeoutMS: 3000,
        keepAlive: 2000,
        reconnectTries: 30,
        useNewUrlParser: true
      }
    );

    Location = mongoose.model("Location", LocationSchema);

    await Location.deleteMany({});
  });

  beforeEach(async () => await createLocations());
  afterEach(async () => await Location.deleteMany({}));

  describe("setup", () => {
    it("should add fields to schema (default options)", () => {
      const DefaultLocationSchema = new mongoose.Schema({ name: String });
      DefaultLocationSchema.plugin(MpathPlugin);

      const LocationModel = dbConnection.model(
        "SomeLocation",
        DefaultLocationSchema
      );

      const schemaPaths = LocationModel.schema.paths;

      should.exist(schemaPaths.parent);
      schemaPaths.parent.options.type.should.eql(mongoose.Schema.ObjectId);
      should.exist(schemaPaths.path);
    });

    it("should add fields to schema (custom options)", async () => {
      const randomId = () =>
        _
          .shuffle(_.range(0, 9))
          .join("")
          .substr(0, 3);

      const CustomLocationSchema = new mongoose.Schema({
        _id: { type: String, default: randomId },
        name: String
      });

      const pluginOptions = {
        idType: String,
        pathSeparator: "."
      };

      CustomLocationSchema.plugin(MpathPlugin, pluginOptions);

      const CustomLocationModel = mongoose.model(
        "SomeOtherLocation",
        CustomLocationSchema
      );

      const schemaPaths = CustomLocationModel.schema.paths;

      // check parent type
      schemaPaths.parent.options.type.should.eql(String);

      // check path separator
      const parentLocation = new CustomLocationModel({ name: "Super City" });
      const childLocation = new CustomLocationModel({
        name: "Sub City",
        parent: parentLocation
      });

      await parentLocation.save();
      await childLocation.save();

      const expectedPath = `${parentLocation._id.toString()}.${childLocation._id.toString()}`;
      childLocation.path.should.equal(expectedPath);
    });
  });

  describe("pre save middleware", () => {
    it("should not perform any operations when document isn't new or hasn't changed parent", async () => {
      sinon.spy(sweden.collection, "findOne");
      sinon.spy(sweden.collection, "updateMany");

      const pathBeforeSave = sweden.path;

      await sweden.save();

      sweden.path.should.equal(pathBeforeSave);
      sinon.assert.notCalled(sweden.collection.findOne);
      sinon.assert.notCalled(sweden.collection.updateMany);
    });

    it("should set parent", () => {
      should.not.exist(africa.parent);
      should.not.exist(europe.parent);
      norway.parent.should.equal(europe._id);
      sweden.parent.should.equal(europe._id);
      stockholm.parent.should.equal(sweden._id);
      globe.parent.should.equal(stockholm._id);
    });

    it("should set path", () => {
      africa.path.should.equal("af");
      europe.path.should.equal("eu");
      norway.path.should.equal("eu.no");
      sweden.path.should.equal("eu.se");
      stockholm.path.should.equal("eu.se.sthlm");
      globe.path.should.equal("eu.se.sthlm.globe");
    });

    it("should update child paths", async () => {
      sweden.parent = africa;
      await sweden.save();

      const locations = await Location.find({});
      const pathObject = locationsToPathObject(locations);

      pathObject.should.eql({
        Africa: "af",
        Europe: "eu",
        Norway: "eu.no",
        Sweden: "af.se",
        Stockholm: "af.se.sthlm",
        Globe: "af.se.sthlm.globe"
      });
    });
  });

  describe("pre remove middleware", () => {
    it("should not reparent/delete children when path is undefined", async () => {
      sweden.path = undefined;
      await sweden.remove();

      const locations = await Location.find({});
      const pathObject = locationsToPathObject(locations);

      pathObject.should.eql({
        Africa: "af",
        Europe: "eu",
        Norway: "eu.no",
        Stockholm: "eu.se.sthlm",
        Globe: "eu.se.sthlm.globe"
      });
    });

    describe('using onDelete="REPARENT" (default)', () => {
      it("should remove leaf nodes", async () => {
        await norway.remove();

        const locations = await Location.find({});
        const pathObject = locationsToPathObject(locations);

        pathObject.should.eql({
          Africa: "af",
          Europe: "eu",
          Sweden: "eu.se",
          Stockholm: "eu.se.sthlm",
          Globe: "eu.se.sthlm.globe"
        });
      });

      it("should reparent when new parent is defined", async () => {
        await sweden.remove();

        const locations = await Location.find({});
        const pathObject = locationsToPathObject(locations);

        pathObject.should.eql({
          Africa: "af",
          Europe: "eu",
          Norway: "eu.no",
          Stockholm: "eu.sthlm",
          Globe: "eu.sthlm.globe"
        });
      });

      it("should reparent when new parent is undefined", async () => {
        await europe.remove();

        const locations = await Location.find({});
        const pathObject = locationsToPathObject(locations);

        pathObject.should.eql({
          Africa: "af",
          Norway: "no",
          Sweden: "se",
          Stockholm: "se.sthlm",
          Globe: "se.sthlm.globe"
        });
      });
    });

    describe('using onDelete="DELETE"', () => {
      before(async () => {
        // re-setup schema, model, database
        await mongoose.connection.close();

        LocationSchema = new mongoose.Schema({ _id: String, name: String });
        LocationSchema.plugin(MpathPlugin, {
          idType: String,
          pathSeparator: ".",
          onDelete: "DELETE" // <- updated plugin option
        });

        dbConnection = await mongoose.connect(
          "mongodb://localhost:27017/mongoose-path-tree",
          {
            connectTimeoutMS: 3000,
            keepAlive: 2000,
            reconnectTries: 30,
            useNewUrlParser: true
          }
        );

        try {
          Location = mongoose.model("Location", LocationSchema);
        } catch (ex) {
          mongoose.connection.deleteModel("Location");
          Location = mongoose.model("Location", LocationSchema);
        }
      });

      beforeEach(async () => await createLocations());

      afterEach(async () => await Location.deleteMany({}));

      it("should delete itself and all children", async () => {
        await sweden.remove();

        const locations = await Location.find({});
        const pathObject = locationsToPathObject(locations);

        pathObject.should.eql({
          Africa: "af",
          Europe: "eu",
          Norway: "eu.no"
        });
      });
    });
  });

  describe('virtual field "level"', () => {
    it("should equal the number of ancestors", () => {
      africa.level.should.equal(1);
      europe.level.should.equal(1);
      norway.level.should.equal(2);
      sweden.level.should.equal(2);
      stockholm.level.should.equal(3);
      globe.level.should.equal(4);
    });
  });

  describe("getImmediateChildren()", () => {
    it("using default params", async () => {
      const conditions = {};
      const fields = null;
      const options = {};

      const locations = await europe.getImmediateChildren(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Norway", "Sweden"]);
    });

    it("using conditions (object)", async () => {
      const conditions = { name: "Norway" };
      const fields = null;
      const options = {};

      const locations = await europe.getImmediateChildren(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Norway"]);
    });

    it("using conditions ($query)", async () => {
      const conditions = { $query: { name: "Norway" } };
      const fields = null;
      const options = {};

      const locations = await europe.getImmediateChildren(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Norway"]);
    });

    it("using fields", async () => {
      const conditions = {};
      const fields = "_id";
      const options = { lean: true };

      const locations = await europe.getImmediateChildren(
        conditions,
        fields,
        options
      );
      locations.should.eql([{ _id: "no" }, { _id: "se" }]);
    });

    it("using options (sort)", async () => {
      const conditions = {};
      const fields = "_id";
      const options = {
        sort: { name: -1 },
        lean: true
      };

      const locations = await europe.getImmediateChildren(
        conditions,
        fields,
        options
      );
    });
  });

  describe("getAllChildren()", () => {
    it("using default params", async () => {
      const conditions = {};
      const fields = null;
      const options = {};

      const locations = await europe.getAllChildren(
        conditions,
        fields,
        options
      );

      locations
        .map(l => l.name)
        .should.eql(["Norway", "Sweden", "Stockholm", "Globe"]);
    });

    it("using conditions (object)", async () => {
      const conditions = { name: "Stockholm" };
      const fields = null;
      const options = {};

      const locations = await europe.getAllChildren(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Stockholm"]);
    });

    it("using conditions ($query)", async () => {
      const conditions = { $query: { name: "Stockholm" } };
      const fields = null;
      const options = {};

      const locations = await europe.getAllChildren(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Stockholm"]);
    });

    it("using fields", async () => {
      const conditions = {};
      const fields = "_id";
      const options = { lean: true };

      const locations = await europe.getAllChildren(
        conditions,
        fields,
        options
      );

      locations.should.eql([
        { _id: "no" },
        { _id: "se" },
        { _id: "sthlm" },
        { _id: "globe" }
      ]);
    });

    it("using options (sort)", async () => {
      const conditions = {};
      const fields = "_id";
      const options = {
        sort: { name: -1 },
        lean: true
      };

      const locations = await europe.getAllChildren(
        conditions,
        fields,
        options
      );

      locations.should.eql([
        { _id: "se" },
        { _id: "sthlm" },
        { _id: "no" },
        { _id: "globe" }
      ]);
    });
  });

  describe("getParent()", () => {
    it("should get the parent", async () => {
      const fields = "name";
      const options = { lean: true };

      const expectedParents = [
        [europe, null],
        [norway, { _id: "eu", name: "Europe" }],
        [sweden, { _id: "eu", name: "Europe" }],
        [stockholm, { _id: "se", name: "Sweden" }],
        [globe, { _id: "sthlm", name: "Stockholm" }],
        [africa, null]
      ];

      Async.forEachSeries(expectedParents, (arr, asyncDone) => {
        const child = arr[0];
        const expectedParent = arr[1];

        child
          .getParent(fields, options, (error, parent) => {
            if (null === expectedParent) {
              should.not.exist(parent);
            } else {
              parent.should.eql(expectedParent);
            }
          })
          .then(() => asyncDone());
      });
    });
  });

  describe("getAncestors()", () => {
    it("using default params", async () => {
      const conditions = {};
      const fields = null;
      const options = {};

      const locations = await stockholm.getAncestors(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Europe", "Sweden"]);
    });

    it("using conditions (plain object)", async () => {
      const conditions = { name: "Europe" };
      const fields = null;
      const options = {};

      const locations = await stockholm.getAncestors(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Europe"]);
    });

    it("using conditions ($query)", async () => {
      const conditions = { $query: { name: "Europe" } };
      const fields = null;
      const options = {};

      const locations = await stockholm.getAncestors(
        conditions,
        fields,
        options
      );

      locations.map(l => l.name).should.eql(["Europe"]);
    });

    it("using fields", async () => {
      const conditions = {};
      const fields = "_id";
      const options = { lean: true };

      const locations = await stockholm.getAncestors(
        conditions,
        fields,
        options
      );

      locations.should.eql([{ _id: "eu" }, { _id: "se" }]);
    });

    it("using options (sort)", async () => {
      const conditions = {};
      const fields = "_id";
      const options = {
        sort: { name: -1 },
        lean: true
      };

      const locations = await stockholm.getAncestors(
        conditions,
        fields,
        options
      );

      locations.should.eql([{ _id: "se" }, { _id: "eu" }]);
    });
  });

  describe("getChildrenTree()", () => {
    // TODO we should refactor the param handling of getChildrenTree since there is no callback anymore that would be a method
    // PROPOSAL: rootDoc should be a property of args, so we only have one param left (args) which would be optional

    // it("should handle find error", async () => {
    //   const LocationMock = sinon.mock(Location);
    //   const errorMessage = "An error occured";
    //
    //   LocationMock.expects("find")
    //     .chain("populate")
    //     .withArgs("")
    //     .yields(errorMessage);
    //
    //   const args = {};
    //
    //   try {
    //     await sweden.getChildrenTree();
    //   } catch (ex) {
    //     LocationMock.verify();
    //     LocationMock.restore();
    //
    //     ex.should.equal(errorMessage);
    //   }
    // });

    it("static method - no args", async () => {
      const expectedTree = [
        {
          __v: 0,
          _id: "af",
          children: [],
          name: "Africa",
          path: "af"
        },
        {
          __v: 0,
          _id: "eu",
          children: [
            {
              __v: 0,
              _id: "no",
              children: [],
              name: "Norway",
              parent: "eu",
              path: "eu.no"
            },
            {
              __v: 0,
              _id: "se",
              children: [
                {
                  __v: 0,
                  _id: "sthlm",
                  children: [
                    {
                      __v: 0,
                      _id: "globe",
                      children: [],
                      name: "Globe",
                      parent: "sthlm",
                      path: "eu.se.sthlm.globe"
                    }
                  ],
                  name: "Stockholm",
                  parent: "se",
                  path: "eu.se.sthlm"
                }
              ],
              name: "Sweden",
              parent: "eu",
              path: "eu.se"
            }
          ],
          name: "Europe",
          path: "eu"
        }
      ];

      const locationTree = await Location.getChildrenTree();
      locationTree.should.eql(expectedTree);
    });

    it("static method - args", async () => {
      const args = {
        fields: "_id name parent path"
      };

      const expectedTree = [
        {
          _id: "af",
          children: [],
          name: "Africa",
          path: "af"
        },
        {
          _id: "eu",
          children: [
            {
              _id: "no",
              children: [],
              name: "Norway",
              parent: "eu",
              path: "eu.no"
            },
            {
              _id: "se",
              children: [
                {
                  _id: "sthlm",
                  children: [
                    {
                      _id: "globe",
                      children: [],
                      name: "Globe",
                      parent: "sthlm",
                      path: "eu.se.sthlm.globe"
                    }
                  ],
                  name: "Stockholm",
                  parent: "se",
                  path: "eu.se.sthlm"
                }
              ],
              name: "Sweden",
              parent: "eu",
              path: "eu.se"
            }
          ],
          name: "Europe",
          path: "eu"
        }
      ];

      const locationTree = await Location.getChildrenTree(null, args);
      locationTree.should.eql(expectedTree);
    });

    it("includes path and parent fields", async () => {
      const args = {
        fields: "_id name"
      };

      const expectedTree = [
        {
          _id: "sthlm",
          children: [
            {
              _id: "globe",
              children: [],
              name: "Globe",
              parent: "sthlm",
              path: "eu.se.sthlm.globe"
            }
          ],
          name: "Stockholm",
          parent: "se",
          path: "eu.se.sthlm"
        }
      ];

      const locationTree = await sweden.getChildrenTree(args);
      locationTree.should.eql(expectedTree);
    });

    it("fields as object", async () => {
      const args = {
        fields: { _id: 1, name: 1 }
      };

      const expectedTree = [
        {
          _id: "sthlm",
          children: [
            {
              _id: "globe",
              children: [],
              name: "Globe",
              parent: "sthlm",
              path: "eu.se.sthlm.globe"
            }
          ],
          name: "Stockholm",
          parent: "se",
          path: "eu.se.sthlm"
        }
      ];

      const locationTree = await sweden.getChildrenTree(args);
      locationTree.should.eql(expectedTree);
    });
  });
});
