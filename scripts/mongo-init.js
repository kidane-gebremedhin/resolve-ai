// Runs once on first start of the mongo container.
// Creates an application user with readWrite on customer-support
// so the API never has to use the root credentials.
db = db.getSiblingDB('customer-support');
db.createUser({
  user: 'csb',
  pwd: 'csb-dev',
  roles: [{ role: 'readWrite', db: 'customer-support' }],
});
