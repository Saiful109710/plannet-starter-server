require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const nodemailer = require("nodemailer");
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

const port = process.env.PORT || 9000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// send email using nodemailer
const sendEmail = (emailAddress,emailData)=>{
  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for port 465, false for other ports
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });

  transporter.verify((error,success)=>{
    if(error){
      console.log(error)
    }else{
      console.log("Transporter is ready to email",success)
    }
  })

  const mailBody = {
    from:  process.env.NODEMAILER_USER, // sender address
    to: emailAddress, // list of receivers
    subject: emailData?.subject,
    text: emailData?.message, // plain text body
    html: `<p>${emailData?.message}</p>`, // html body
  }

  // send email

  transporter.sendMail(mailBody,(error,info)=>{
    if(error){
      console.log(error)
    }else{
      console.log(info)
      console.log('Email Sent:',info?.response)
    }
  })

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.92ej0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {



 
  try {

    const userCollection = client.db('plant-net').collection('users')
    const plantsCollection = client.db('plant-net').collection('plants')
    const orderCollection = client.db('plant-net').collection('orders')


    // verifyAdmin middleware
    const verifyAdmin = async(req,res,next)=>{
            console.log("data from verify token middleware",req.user)
            const email = req.user?.email
            const query={email}
            const result = await userCollection.findOne(query)
            if(!result || result?.role !=='admin'){
              return res.status(403).send({message:'Forbidden Access! Admin Only'})
            }
            next()

    }

    // verify seller middleware
    const verifySeller = async(req,res,next)=>{
      const email = req.user?.email
      const query = {email}
      const result = await userCollection.findOne(query)
      if(!result || result?.role !=="seller"){
        return res.status(403).send({message:'Forbidden Access! Seller Only'})
      }
      next()
    }
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })


     // save or update a user in db

  app.post('/users/:email',async(req,res)=>{
    sendEmail()
    const email = req.params.email
    const query = {email}
    const user = req.body
    console.log(user)

    // check if user already exist in db

    const isExist = await userCollection.findOne(query)

    if(isExist){
      return res.send(isExist)
    }

    const result = await userCollection.insertOne({...user,timestamp:Date.now(),role:'customer'})
    res.send(result)
  })

  // manage user status and role

  app.patch('/users/:email',verifyToken,async(req,res)=>{
    const email = req.params.email
    const query = {email}
    const user = await userCollection.findOne(query)
    if(!user || user?.status === 'Requested'){
      return res.status(400).send('You have already requested, wait for some time')
    }

    const updatedDoc = {
      $set:{
        status:'Requested'
      }
    }

    const result = await userCollection.updateOne(query,updatedDoc)
    res.send(result)
  })

  // get user role

  app.get('/users/role/:email',async(req,res)=>{
    const email = req.params.email
    const result = await userCollection.findOne({email})
    res.send({role:result?.role})
  })

  // get all user
  app.get('/all-users/:email',verifyToken,verifyAdmin,async(req,res)=>{
    const email = req.params.email
    const query={email:{$ne:email}}
    const result = await userCollection.find(query).toArray()
    res.send(result)
  })

  // update user role and status
  app.patch('/user/role/:email',verifyToken,async(req,res)=>{
    const email = req.params.email
    const {role} = req.body
    const filter = {email}
    const updatedDoc = {
      $set:{
        role,status:'Verified'
      }
    }
    const result = await userCollection.updateOne(filter,updatedDoc)
    res.send(result)
  })



  app.get('/plants',async(req,res)=>{
      const result = await plantsCollection.find().toArray()
      res.send(result)
  })

  // save plant data in db


  app.post('/plants',verifyToken,verifySeller,async(req,res)=>{
    const plant = req.body
    const result = await plantsCollection.insertOne(plant)
    res.send(result)
  })

  // get plant data by id
  app.get('/plants/:id',async(req,res)=>{
    const id  = req.params.id
    const query = {_id:new ObjectId(id)}
    const result = await plantsCollection.findOne(query)
    res.send(result)
  })

  // save order data in db

  app.post('/order',verifyToken,async(req,res)=>{
    const orderInfo = req.body
    console.log(orderInfo)
    const result = await orderCollection.insertOne(orderInfo)
    if(result?.insertedId){
      // To Customer
      sendEmail(orderInfo?.customerInfo?.email,{
        subject:'Order Successful',
        message:`You've placed an order successfully. Transaction Id: ${result?.insertedId}`
      })

      // to seller
      sendEmail(orderInfo?.seller,{
        subject:'You have an order to process',
        message:`Get the plants ready for ${orderInfo?.customerInfo?.name}`
      })

    }
    res.send(result)
  })

  // manage plant quantity
  app.patch('/plants/quantity/:id',verifyToken,async(req,res)=>{
    const id = req.params.id
    const {quantityToUpdate,status} = req.body
    const filter = {_id:new ObjectId(id)}
    let updatedDoc = {
      $inc:{quantity:-quantityToUpdate}
    }

    if(status==='increase'){
      updatedDoc = {
        $inc:{quantity:quantityToUpdate}
      }
    }
    const result = await plantsCollection.updateOne(filter,updatedDoc)
    res.send(result)
  })

  // get all  orders for specific customer
  app.get('/customer-orders/:email',verifyToken,async(req,res)=>{
    const email = req.params.email;
    const query = {'customerInfo.email':email}
    

    const result = await orderCollection.aggregate([
      {
        $match:query  //Match specific customers data only by email
      },
      {
        $addFields:{
          plantId:{$toObjectId:'$plantId'}  //convert plantsId string field to objectId field
        }
      },
      {
        $lookup:{
          // got to different collection and look for data
          from:'plants',   //collection name
          localField:'plantId',  // local data that you want to match
          foreignField:'_id',  // foreign field name of the same data
          as:'plants'  // return the data as plants array
        }
      },
      {
        $unwind:'$plants'   // unwind lookup result, return without array
      },
      {
        $addFields:{
          // add these field in order object
          name:'$plants.name',
          image:'$plants.image',
          category:'$plants.category'
        }
      },
      {
        // remove plants object property from order object
        $project:{
          plants:0

        }
      }
    ]).toArray()
    res.send(result)
  })

  // update order status
  app.patch('/orders/:id',verifyToken,verifySeller,async(req,res)=>{
    const id = req.params.id
    const {status} = req.body
    const filter = {_id:new ObjectId(id)}
    const updatedDoc = {
      $set:{status}
    }
    const result = await orderCollection.updateOne(filter,updatedDoc)
    res.send(result)
  })

  // get all order for specific seller using aggregate method
  app.get('/seller-orders/:email',verifyToken,verifySeller,async(req,res)=>{
    const email=req.params.email
    const result = await orderCollection.aggregate([
      {
        $match:{seller:email}
      },
      {
        $addFields:{
          plantId:{$toObjectId:'$plantId'}
        }
      },
      {
        $lookup:{
          from:'plants',
          localField:'plantId',
          foreignField:'_id',
          as:'plants'
        }
      },
      {
        $unwind:'$plants'
      },
      {
        $addFields:{
          name:'$plants.name'
        }
      },
      {
        $project:{
          plants:0
        }
      }
    ]).toArray()
    res.send(result)
  })


  // cancel/delete an order api

  app.delete('/order/:id',verifyToken,async(req,res)=>{
      const id = req.params.id
      const query = {_id:new ObjectId(id)}
      const order = await orderCollection.findOne(query)
      if(order.status==='Delivered'){
        return res.status(409).send('Cannot cancel once the product delivered')
      }
      const result = await orderCollection.deleteOne(query)
      res.send(result)
  })

  // get inventory data for seller
  app.get('/plant/seller',verifyToken,verifySeller,async(req,res)=>{
    const email = req.user.email
    console.log(email)
    const query = {'sellerInfo.email':email}
    const result = await plantsCollection.find(query).toArray()
    res.send(result)


  })

  // delete a plant from db by seller
  app.delete('/plant/:id',verifyToken,verifySeller,async(req,res)=>{
    const id = req.params.id
    const query = {_id:new ObjectId(id)}
    const result = await plantsCollection.deleteOne(query)
    res.send(result)
  })

  // admin stats
  app.get('/admin-stats',verifyToken,verifyAdmin,async(req,res)=>{
    // get total user and total plants
    const totalUser  = await userCollection.countDocuments()
    const totalPlants = await plantsCollection.estimatedDocumentCount()

    const allOrder = await orderCollection.find().toArray()
    // const totalPrice = allOrder.reduce((sum,order)=>sum+order.price,0)
    // const  totalOrder = allOrder.length

    // generate chart data
    // const myData = {
    //   date:'11/02/2025',
    //   quantity:4000,
    //   price:2400,
    //   order:2400,
  
    // }

    const chartData = await orderCollection.aggregate([
      {
        $addFields:{
          _id:{
            $dateToString:{
              format:'%Y-%m-%d',
              date:{$toDate:'$_id'}
            },
          },
          quantity:{
            $sum:'$quantity'
          },
          price:{$sum:'$price'},
          order:{$sum:1},

          
        }
      },
      {
        $project:{
          _id:0,
          date:'$_id',
          quantity:1,
          order:1,
          price:1

        }
      },
      {
        $sort:{date:-1}
      }
    ]).toArray()

    console.log(chartData)

    // get total revenue,and total order
    const orderDetails = await orderCollection.aggregate([
      {
        $group:{
          _id:null,
          totalRevenue:{$sum:'$price'},
          totalOrder:{$sum:1}
        }
      },
      {
        $project:{
          _id:0
        }
      }
    ]).next()
    
    res.send({totalPlants,totalUser,...orderDetails,chartData})
  })

  // create payment intent
  app.post('/create-payment-intent',verifyToken,async(req,res)=>{
    const {quantity,plantId} = req.body
    const query={_id:new ObjectId(plantId)}
    const plant = await plantsCollection.findOne(query)
    if(!plant){
      return res.status(400).send('Plant not found')
    }

    const totalPrice = (quantity * plant.price)*100 // total price in sent poysha
    const {client_secret} = await stripe.paymentIntents.create({
      amount: totalPrice,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
    });
    res.send({clientSecret:client_secret})


  })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})



