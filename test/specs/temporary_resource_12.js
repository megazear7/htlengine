
/*******************************************.
/*******************************************.

I copied this file from the /test/generated directory to see if I could manually
create the run time for doing recursive data-sly-resource calls first before
generating it dynamically at compile time.

/*******************************************.
/*******************************************.

/* eslint-disable */
module.exports = function main(runtime) {
  const lengthOf = function (c) {
    return Array.isArray(c) ? c.length : Object.keys(c).length;
  };

  const out = runtime.out.bind(runtime);
  const exec = runtime.exec.bind(runtime);
  const xss = runtime.xss.bind(runtime);
  const listInfo = runtime.listInfo.bind(runtime);
  const use = runtime.use.bind(runtime);
  const slyResource = runtime.resource.bind(runtime);
  const call = runtime.call.bind(runtime);
  const template = runtime.template.bind(runtime);


  return runtime.run(function* () {

    const resource = runtime.globals;

    /* ALEX Note:
       The below JS code was generated from here: src/parser/plugins/ResourcePlugin.js
       How do we make this so that it pulls in the file and parses it as html instead
       of just yielding the contents?
    */
    let var_resourceContent0;
    out("<section>");
    var_resourceContent0 = yield slyResource("resource_spec/recursion_test.html");
    out(var_resourceContent0);
    if (false) {
    }
    out("</section>\n");

  });
};
