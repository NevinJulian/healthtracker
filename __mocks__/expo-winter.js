// Stub for expo/src/winter — prevents the winter runtime from being installed
// in Jest. The real module uses dynamic import() at the module level which
// Jest 30 blocks with "You are trying to import a file outside of the scope
// of the test code."
module.exports = {};
