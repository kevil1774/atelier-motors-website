import {Router} from 'express';

import multer from 'multer';

import rateLimit from 'express-rate-limit';

import path from 'node:path';

import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';

import jwt from 'jsonwebtoken';

import {Car,Customer,Enquiry,Sale,User} from './models.js';


const r=Router();


/*
 * Authentication middleware.
 *
 * The JWT is stored in an HttpOnly cookie instead of
 * browser localStorage. HttpOnly prevents JavaScript
 * running in the browser from directly reading the token.
 *
 * A Bearer-token fallback is retained for existing API
 * clients/tests that may still use Authorization headers.
 */
const auth=(req,res,next)=>{
    try{
        const cookieToken=req.cookies?.atelier_token;

        const bearerToken=(req.headers.authorization||'')
            .replace(/^Bearer /,'');

        const token=cookieToken||bearerToken;

        if(!token)throw 0;

        req.user=jwt.verify(
            token,
            process.env.JWT_SECRET||'dev-only-secret'
        );

        next();
    }catch{
        res.status(401).json({
            message:'Please sign in to continue.'
        });
    }
};


const admin=async(req,res,next)=>{
    try{
        const u=await User.findById(req.user.id);

        if(!u?.active)
            return res.status(403).json({
                message:'Administrator access required.'
            });

        next()
    }catch(e){
        next(e)
    }
};


const protect=(req,res,next)=>auth(req,res,()=>admin(req,res,next));


const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);


const clean=(value)=>{
    if(typeof value==='string')return value.trim();

    if(Array.isArray(value))return value.map(clean);

    if(value&&typeof value==='object'){
        for(const k of Object.keys(value))value[k]=clean(value[k])
    }

    return value
};


/*
 * Authentication
 */

/*
 * Login
 *
 * The JWT is now placed inside an HttpOnly cookie.
 * It is no longer returned as a JSON token for the
 * frontend to store in localStorage.
 */
r.post('/auth/login',
    rateLimit({
        windowMs:15*60*1000,
        limit:10,
        standardHeaders:true,
        legacyHeaders:false,
        message:{
            message:'Too many sign-in attempts. Try again later.'
        }
    }),

    wrap(async(req,res)=>{
        const {email,password}=req.body;

        const user=await User.findOne({
            email:String(email||'').toLowerCase()
        }).select('+password');


        if(!user||!user.active||!await bcrypt.compare(password||'',user.password))
            return res.status(401).json({
                message:'Email or password is incorrect.'
            });


        const token=jwt.sign(
            {id:user.id,role:user.role},
            process.env.JWT_SECRET||'dev-only-secret',
            {expiresIn:'12h'}
        );


        /*
         * HttpOnly cookie:
         *
         * httpOnly: JavaScript cannot read the JWT.
         * secure: HTTPS is required in production.
         * sameSite: helps protect against cross-site requests.
         * maxAge: cookie expires after 12 hours.
         */
        res.cookie('atelier_token',token,{
            httpOnly:true,
            secure:process.env.NODE_ENV==='production',
            sameSite:'lax',
            maxAge:12*60*60*1000,
            path:'/'
        });


        /*
         * Only return non-sensitive user information.
         * The JWT is intentionally NOT returned.
         */
        res.json({
            user:{
                id:user.id,
                name:user.name,
                email:user.email,
                role:user.role
            }
        })
    })
);


/*
 * Restore the currently authenticated session.
 *
 * The browser automatically sends the HttpOnly cookie.
 */
r.get('/auth/me',
    auth,
    wrap(async(req,res)=>{
        const user=await User.findById(req.user.id)
            .select('name email role active');

        if(!user?.active)
            return res.status(401).json({
                message:'Please sign in to continue.'
            });

        res.json({
            user:{
                id:user.id,
                name:user.name,
                email:user.email,
                role:user.role
            }
        });
    })
);


/*
 * Logout
 *
 * Clearing the cookie removes the browser session.
 */
r.post('/auth/logout',
    (req,res)=>{
        res.clearCookie('atelier_token',{
            httpOnly:true,
            secure:process.env.NODE_ENV==='production',
            sameSite:'lax',
            path:'/'
        });

        res.json({
            message:'Signed out successfully.'
        });
    }
);


/*
 * User management
 */

r.post('/auth/register',
    protect,

    wrap(async(req,res)=>{
        const data=clean(req.body);

        data.password=await bcrypt.hash(data.password,12);

        res.status(201).json(await User.create(data))
    })
);


r.get('/users',
    protect,

    wrap(async(req,res)=>
        res.json(
            await User.find()
                .select('name email role active createdAt')
                .sort('name')
                .lean()
        )
    )
);


r.post('/users',
    protect,

    wrap(async(req,res)=>{
        const data=clean(req.body);


        if(!data.password||data.password.length<10)
            return res.status(400).json({
                message:'Password must contain at least 10 characters.'
            });


        data.password=await bcrypt.hash(data.password,12);

        res.status(201).json(await User.create(data))
    })
);


r.put('/users/:id',
    protect,

    wrap(async(req,res)=>{
        const data=clean(req.body);


        if(data.password){

            if(data.password.length<10)
                return res.status(400).json({
                    message:'Password must contain at least 10 characters.'
                });


            data.password=await bcrypt.hash(data.password,12)
        }else{
            delete data.password
        }


        const user=await User.findByIdAndUpdate(
            req.params.id,
            data,
            {new:true,runValidators:true}
        ).select('name email role active createdAt');


        if(!user)
            return res.status(404).json({
                message:'User not found.'
            });


        res.json(user)
    })
);


r.delete('/users/:id',
    protect,

    wrap(async(req,res)=>{
        if(req.params.id===req.user.id)
            return res.status(400).json({
                message:'You cannot remove your own account.'
            });


        const user=await User.findByIdAndDelete(req.params.id);


        if(!user)
            return res.status(404).json({
                message:'User not found.'
            });


        res.json({message:'User deleted.'})
    })
);


/*
 * Generic list helper
 */

const list=Model=>wrap(async(req,res)=>{
    const {
        page=1,
        limit=50,
        search,
        status,
        brand,
        fuelType,
        transmission,
        minPrice,
        maxPrice,
        minYear,
        maxYear,
        sort='-createdAt'
    }=req.query;


    const q={};


    if(search)
        q.$or=[
            'name',
            'email',
            'phone',
            'brand',
            'model',
            'customerName',
            'message'
        ].map(k=>({
            [k]:{
                $regex:String(search),
                $options:'i'
            }
        }));


    if(status)
        q.status=status;
    else if(Model===Car&&req.path==='/cars')
        q.status='Available';


    if(brand)
        q.brand=brand;


    if(fuelType)
        q.fuelType=fuelType;


    if(transmission)
        q.transmission=transmission;


    if(minPrice||maxPrice)
        q.price={
            $gte:Number(minPrice)||0,
            ...(maxPrice?{$lte:Number(maxPrice)}:{})
        };


    if(minYear||maxYear)
        q.year={
            $gte:Number(minYear)||0,
            ...(maxYear?{$lte:Number(maxYear)}:{})
        };


    let query=Model.find(q)
        .sort(sort)
        .skip((Number(page)-1)*Number(limit))
        .limit(Number(limit));


    if(Model===Sale||Model===Enquiry)
        query=query.populate('customer car');


    const [items,total]=await Promise.all([
        query.lean(),
        Model.countDocuments(q)
    ]);


    res.json({
        items,
        total,
        page:Number(page),
        pages:Math.ceil(total/Number(limit))
    })
});


/*
 * Only Sale and Enquiry documents contain customer/car references.
 * Cars and Customers must be returned without population.
 */
const populateRelations=(query,Model)=>{
    if(Model===Sale||Model===Enquiry)
        return query.populate('customer car');


    return query;
};


const CRUD=(base,Model,publicRead=false)=>{

    r.get(
        base,
        publicRead?list(Model):protect,
        list(Model)
    );


    r.get(
        `${base}/:id`,
        publicRead
            ?wrap(async(req,res)=>{
                const query=Model.findById(req.params.id);
                const item=await populateRelations(query,Model);


                if(!item)
                    return res.status(404).json({
                        message:'Record not found.'
                    });


                res.json(item)
            })
            :protect,
        wrap(async(req,res)=>{
            const query=Model.findById(req.params.id);
            const item=await populateRelations(query,Model);


            if(!item)
                return res.status(404).json({
                    message:'Record not found.'
                });


            res.json(item)
        })
    );


    r.post(
        base,
        protect,
        wrap(async(req,res)=>
            res.status(201).json(
                await Model.create(clean(req.body))
            )
        )
    );


    r.put(
        `${base}/:id`,
        protect,
        wrap(async(req,res)=>{
            const item=await Model.findByIdAndUpdate(
                req.params.id,
                clean(req.body),
                {new:true,runValidators:true}
            );


            if(!item)
                return res.status(404).json({
                    message:'Record not found.'
                });


            res.json(item)
        })
    );


    r.delete(
        `${base}/:id`,
        protect,
        wrap(async(req,res)=>{
            const item=await Model.findByIdAndDelete(req.params.id);


            if(!item)
                return res.status(404).json({
                    message:'Record not found.'
                });


            res.json({message:'Record deleted.'})
        })
    )
};


CRUD('/cars',Car,true);

CRUD('/customers',Customer);

CRUD('/enquiries',Enquiry);


/*
 * Sale writes keep vehicle availability in sync,
 * including edits and cancellation.
 */

r.get('/sales',
    protect,
    list(Sale)
);


r.get('/sales/:id',
    protect,

    wrap(async(req,res)=>{
        const item=await Sale.findById(req.params.id)
            .populate('customer car');


        if(!item)
            return res.status(404).json({
                message:'Record not found.'
            });


        res.json(item)
    })
);


r.post('/sales',
    protect,

    wrap(async(req,res)=>{
        const d=clean(req.body);


        const car=await Car.findById(d.car);


        if(!car)
            return res.status(404).json({
                message:'Vehicle not found.'
            });


        if(car.status==='Sold')
            return res.status(400).json({
                message:'This vehicle has already been sold.'
            });


        const sale=await Sale.create(d);


        if(sale.status==='Completed')
            car.status='Sold';
        else
            car.status='Reserved';


        await car.save();


        res.status(201).json(
            await sale.populate('customer car')
        )
    })
);


r.put('/sales/:id',
    protect,

    wrap(async(req,res)=>{
        const prior=await Sale.findById(req.params.id);


        if(!prior)
            return res.status(404).json({
                message:'Record not found.'
            });


        const before=prior.toObject();


        const sale=await Sale.findByIdAndUpdate(
            req.params.id,
            clean(req.body),
            {new:true,runValidators:true}
        );


        const oldCar=await Car.findById(before.car);


        if(oldCar){

            const other=await Sale.exists({
                _id:{$ne:sale.id},
                car:oldCar.id,
                status:'Completed'
            });


            oldCar.status=other?'Sold':'Available';

            await oldCar.save()
        }


        const newCar=await Car.findById(sale.car);


        if(newCar){

            if(sale.status==='Completed')
                newCar.status='Sold';

            else if(newCar.status!=='Sold')
                newCar.status='Reserved';


            await newCar.save()
        }


        res.json(
            await sale.populate('customer car')
        )
    })
);


r.delete('/sales/:id',
    protect,

    wrap(async(req,res)=>{
        const sale=await Sale.findByIdAndDelete(req.params.id);


        if(!sale)
            return res.status(404).json({
                message:'Record not found.'
            });


        const car=await Car.findById(sale.car);


        if(car&&!await Sale.exists({
            car:car.id,
            status:'Completed'
        })){

            car.status='Available';

            await car.save()
        }


        res.json({message:'Sale deleted.'})
    })
);


/*
 * Public enquiry submission creates/links a customer;
 * admin reads remain protected.
 */

r.post('/public/enquiries',
    wrap(async(req,res)=>{
        const d=clean(req.body);


        if(!d.customerName||!d.email||!d.phone||!d.message)
            return res.status(400).json({
                message:'Name, email, phone and message are required.'
            });


        let customer=await Customer.findOne({
            email:d.email
        });


        if(!customer)
            customer=await Customer.create({
                name:d.customerName,
                email:d.email,
                phone:d.phone,
                status:'Lead'
            });


        res.status(201).json(
            await Enquiry.create({
                ...d,
                customer:customer.id
            })
        )
    })
);


/*
 * Image upload
 */

const storage=multer.diskStorage({
    destination:(req,file,cb)=>
        cb(
            null,
            path.resolve(
                process.env.UPLOAD_DIR||'backend/uploads'
            )
        ),

    filename:(req,file,cb)=>
        cb(
            null,
            crypto.randomUUID()+
            path.extname(file.originalname).toLowerCase()
        )
});


const upload=multer({
    storage,

    limits:{
        fileSize:5*1024*1024,
        files:10
    },

    fileFilter:(req,file,cb)=>{
        const ok={
            'image/jpeg':['.jpg','.jpeg'],
            'image/png':['.png'],
            'image/webp':['.webp'],
            'image/avif':['.avif']
        }[
            file.mimetype
        ]?.includes(
            path.extname(file.originalname).toLowerCase()
        );


        if(ok)
            cb(null,true);
        else{

            const error=new Error(
                'Upload JPEG, PNG, WebP or AVIF images only.'
            );

            error.status=400;

            cb(error)
        }
    }
});


r.post(
    '/upload',
    protect,
    upload.array('images',10),

    wrap(async(req,res)=>
        res.status(201).json({
            images:req.files.map(
                f=>`/uploads/${f.filename}`
            )
        })
    )
);


/*
 * Dashboard statistics
 */

r.get(
    '/dashboard/stats',
    protect,

    wrap(async(req,res)=>{
        const [
            cars,
            customers,
            enquiries,
            sales,
            revenue,
            monthly
        ]=await Promise.all([

            Car.aggregate([
                {
                    $group:{
                        _id:'$status',
                        count:{$sum:1}
                    }
                }
            ]),

            Customer.countDocuments(),

            Enquiry.countDocuments({status:'New'}),

            Sale.countDocuments({status:'Completed'}),

            Sale.aggregate([
                {$match:{status:'Completed'}},

                {
                    $group:{
                        _id:null,
                        total:{$sum:'$salePrice'}
                    }
                }
            ]),

            Sale.aggregate([
                {
                    $match:{
                        status:'Completed',
                        saleDate:{
                            $gte:new Date(
                                new Date().getFullYear(),
                                0,
                                1
                            )
                        }
                    }
                },

                {
                    $group:{
                        _id:{$month:'$saleDate'},
                        sales:{$sum:1},
                        revenue:{$sum:'$salePrice'}
                    }
                },

                {$sort:{_id:1}}
            ])
        ]);


        const by=Object.fromEntries(
            cars.map(x=>[x._id,x.count])
        );


        res.json({
            totalCars:cars.reduce(
                (a,x)=>a+x.count,
                0
            ),

            availableCars:by.Available||0,

            reservedCars:by.Reserved||0,

            soldCars:by.Sold||0,

            totalCustomers:customers,

            newEnquiries:enquiries,

            completedSales:sales,

            totalRevenue:revenue[0]?.total||0,

            monthly
        })
    })
);


export default r;