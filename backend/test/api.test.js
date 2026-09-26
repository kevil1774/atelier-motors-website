import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import {User,Car,Customer,Enquiry,Sale} from '../src/models.js';

const uri=process.env.TEST_MONGODB_URI;
const skip=!uri;
let token,customer,car;
before(async()=>{if(!uri)return;await mongoose.connect(uri);await Promise.all([User.deleteMany({}),Car.deleteMany({}),Customer.deleteMany({}),Enquiry.deleteMany({}),Sale.deleteMany({})]);await User.create({name:'Test Admin',email:'admin@test.local',password:await bcrypt.hash('TestPassword123!',10),role:'admin'});const auth=await request(app).post('/api/auth/login').send({email:'admin@test.local',password:'TestPassword123!'});assert.equal(auth.status,200);token=auth.body.token;customer=await Customer.create({name:'Test Driver',email:'driver@test.local',phone:'5551234567'});car=await Car.create({brand:'Porsche',model:'911',year:2023,price:100000,status:'Available'})});
after(async()=>{if(uri)await mongoose.disconnect()});
const auth=()=>({Authorization:`Bearer ${token}`});

test('authentication rejects invalid credentials and accepts the seeded admin', {skip},async()=>{assert.equal((await request(app).post('/api/auth/login').send({email:'bad@test.local',password:'no'})).status,401);assert.ok(token)});
test('car CRUD works and public inventory hides sold vehicles', {skip},async()=>{const created=await request(app).post('/api/cars').set(auth()).send({brand:'BMW',model:'M3',year:2022,price:65000,status:'Available'});assert.equal(created.status,201);const id=created.body._id;assert.equal((await request(app).get(`/api/cars/${id}`)).status,200);assert.equal((await request(app).put(`/api/cars/${id}`).set(auth()).send({price:62000})).body.price,62000);assert.equal((await request(app).delete(`/api/cars/${id}`).set(auth())).status,200);await Car.findByIdAndUpdate(car.id,{status:'Sold'});assert.equal((await request(app).get('/api/cars')).body.items.some(x=>x._id===car.id),false)});
test('customer CRUD works', {skip},async()=>{const c=await request(app).post('/api/customers').set(auth()).send({name:'New Customer',phone:'5558887777'});assert.equal(c.status,201);assert.equal((await request(app).get('/api/customers').set(auth())).body.total,2);assert.equal((await request(app).put(`/api/customers/${c.body._id}`).set(auth()).send({city:'Austin'})).body.city,'Austin');assert.equal((await request(app).delete(`/api/customers/${c.body._id}`).set(auth())).status,200)});
test('enquiry CRUD works', {skip},async()=>{const e=await request(app).post('/api/enquiries').set(auth()).send({customerName:'Guest',email:'guest@example.com',phone:'5553334444',message:'Interested',car:car.id});assert.equal(e.status,201);assert.equal((await request(app).get(`/api/enquiries/${e.body._id}`).set(auth())).status,200);assert.equal((await request(app).put(`/api/enquiries/${e.body._id}`).set(auth()).send({status:'Contacted'})).body.status,'Contacted');assert.equal((await request(app).delete(`/api/enquiries/${e.body._id}`).set(auth())).status,200)});
test('sale CRUD syncs vehicle availability', {skip},async()=>{await Car.findByIdAndUpdate(car.id,{status:'Available'});const s=await request(app).post('/api/sales').set(auth()).send({customer:customer.id,car:car.id,salePrice:99000,status:'Pending'});assert.equal(s.status,201);assert.equal((await Car.findById(car.id)).status,'Reserved');assert.equal((await request(app).put(`/api/sales/${s.body._id}`).set(auth()).send({status:'Completed'})).body.status,'Completed');assert.equal((await Car.findById(car.id)).status,'Sold');assert.equal((await request(app).delete(`/api/sales/${s.body._id}`).set(auth())).status,200);assert.equal((await Car.findById(car.id)).status,'Available')});
test('dashboard stats are database-backed', {skip},async()=>{const stats=await request(app).get('/api/dashboard/stats').set(auth());assert.equal(stats.status,200);assert.equal(typeof stats.body.totalCars,'number');assert.equal(typeof stats.body.totalRevenue,'number')});
