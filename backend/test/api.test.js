import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import { User, Car, Customer, Enquiry, Sale } from '../src/models.js';

const uri = process.env.TEST_MONGODB_URI;
const skip = !uri;

let customer;
let car;
let agent;

before(async () => {
  if (!uri) return;

  await mongoose.connect(uri);

  await Promise.all([
    User.deleteMany({}),
    Car.deleteMany({}),
    Customer.deleteMany({}),
    Enquiry.deleteMany({}),
    Sale.deleteMany({})
  ]);

  await User.create({
    name: 'Test Admin',
    email: 'admin@test.local',
    password: await bcrypt.hash('TestPassword123!', 10),
    role: 'admin'
  });

  // Supertest agent preserves the HttpOnly authentication cookie
  // returned by the login endpoint.
  agent = request.agent(app);

  const auth = await agent
    .post('/api/auth/login')
    .send({
      email: 'admin@test.local',
      password: 'TestPassword123!'
    });

  assert.equal(auth.status, 200);
  assert.ok(auth.headers['set-cookie']);

  customer = await Customer.create({
    name: 'Test Driver',
    email: 'driver@test.local',
    phone: '5551234567'
  });

  car = await Car.create({
    brand: 'Porsche',
    model: '911',
    year: 2023,
    price: 100000,
    status: 'Available'
  });
});

after(async () => {
  if (uri) {
    await mongoose.disconnect();
  }
});

test(
  'authentication rejects invalid credentials and accepts the seeded admin',
  { skip },
  async () => {
    const invalid = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'bad@test.local',
        password: 'no'
      });

    assert.equal(invalid.status, 401);

    const me = await agent.get('/api/auth/me');

    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'admin@test.local');
    assert.equal(me.body.user.role, 'admin');
  }
);

test(
  'car CRUD works and public inventory hides sold vehicles',
  { skip },
  async () => {
    const created = await agent
      .post('/api/cars')
      .send({
        brand: 'BMW',
        model: 'M3',
        year: 2022,
        price: 65000,
        status: 'Available'
      });

    assert.equal(created.status, 201);

    const id = created.body._id;

    assert.equal(
      (await request(app).get(`/api/cars/${id}`)).status,
      200
    );

    assert.equal(
      (
        await agent
          .put(`/api/cars/${id}`)
          .send({ price: 62000 })
      ).body.price,
      62000
    );

    assert.equal(
      (await agent.delete(`/api/cars/${id}`)).status,
      200
    );

    await Car.findByIdAndUpdate(car.id, {
      status: 'Sold'
    });

    assert.equal(
      (await request(app).get('/api/cars')).body.items.some(
        x => x._id === car.id
      ),
      false
    );
  }
);

test(
  'customer CRUD works',
  { skip },
  async () => {
    const c = await agent
      .post('/api/customers')
      .send({
        name: 'New Customer',
        phone: '5558887777'
      });

    assert.equal(c.status, 201);

    assert.equal(
      (await agent.get('/api/customers')).body.total,
      2
    );

    assert.equal(
      (
        await agent
          .put(`/api/customers/${c.body._id}`)
          .send({ city: 'Austin' })
      ).body.city,
      'Austin'
    );

    assert.equal(
      (await agent.delete(`/api/customers/${c.body._id}`)).status,
      200
    );
  }
);

test(
  'enquiry CRUD works',
  { skip },
  async () => {
    const e = await agent
      .post('/api/enquiries')
      .send({
        customerName: 'Guest',
        email: 'guest@example.com',
        phone: '5553334444',
        message: 'Interested',
        car: car.id
      });

    assert.equal(e.status, 201);

    assert.equal(
      (
        await agent.get(`/api/enquiries/${e.body._id}`)
      ).status,
      200
    );

    assert.equal(
      (
        await agent
          .put(`/api/enquiries/${e.body._id}`)
          .send({ status: 'Contacted' })
      ).body.status,
      'Contacted'
    );

    assert.equal(
      (
        await agent.delete(`/api/enquiries/${e.body._id}`)
      ).status,
      200
    );
  }
);

test(
  'sale CRUD syncs vehicle availability',
  { skip },
  async () => {
    await Car.findByIdAndUpdate(car.id, {
      status: 'Available'
    });

    const s = await agent
      .post('/api/sales')
      .send({
        customer: customer.id,
        car: car.id,
        salePrice: 99000,
        status: 'Pending'
      });

    assert.equal(s.status, 201);

    assert.equal(
      (await Car.findById(car.id)).status,
      'Reserved'
    );

    assert.equal(
      (
        await agent
          .put(`/api/sales/${s.body._id}`)
          .send({ status: 'Completed' })
      ).body.status,
      'Completed'
    );

    assert.equal(
      (await Car.findById(car.id)).status,
      'Sold'
    );

    assert.equal(
      (await agent.delete(`/api/sales/${s.body._id}`)).status,
      200
    );

    assert.equal(
      (await Car.findById(car.id)).status,
      'Available'
    );
  }
);

test(
  'dashboard stats are database-backed',
  { skip },
  async () => {
    const stats = await agent.get('/api/dashboard/stats');

    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.totalCars, 'number');
    assert.equal(typeof stats.body.totalRevenue, 'number');
  }
);