import * as mongoose from 'mongoose'
import * as express from 'express'
import * as bodyParser from 'body-parser'
import * as webpush from 'web-push'

const mongoUri =
	process.env.MONGODB_URI ||
	process.env.MONGOHQ_URL ||
	'mongodb://localhost/push_messenger'

const port = process.env.PORT || 5000

const app = express()
app.use((request, response, next) => {
	response.header('Access-Control-Allow-Origin', '*')
	response.header(
		'Access-Control-Allow-Headers',
		'Origin, X-Requested-With, Content-Type, Accept'
	)
	next()
})
app.use(bodyParser.json())
app.listen(port, () => console.log(`Http server running on ${port}`))

mongoose
	.connect(mongoUri, { useCreateIndex: true, useNewUrlParser: true })
	.then(() => console.log('Connected to db'))

const userSchema = new mongoose.Schema({
	id: {
		type: mongoose.Schema.Types.ObjectId,
		index: true,
		required: true,
		auto: true,
	},
	devices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Device' }],
	groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
})

const deviceSchema = new mongoose.Schema({
	subscription: Object,
})

const groupSchema = new mongoose.Schema({
	label: {
		type: String,
		index: true,
		required: true,
	},
})

const User = mongoose.model('User', userSchema)
const Device = mongoose.model('Device', deviceSchema)
const Group = mongoose.model('Group', groupSchema)

app.get('/', (request, response) => {
	response.send('Push messenger v1')
})

// Add user
app.post('/api/v1/user/', async (request, response) => {
	const user = await new User().save()
	const userId = user.id

	response.send({
		userId,
		message: `Created user with id "${userId}"`,
	})
})

// Get devices
app.post('/api/v1/user/:userId/devices/', (request, response) => {})

// Add device
app.post('/api/v1/user/:userId/device/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}
	const device = await new Device({ subscription: request.body }).save()
	// @ts-ignore
	await user.devices.push(device)
	await user.save()

	const deviceId = device._id

	response.send({
		deviceId,
		message: `Device with id "${deviceId}" added to user "${userId}"`,
	})
})

// Get groups
app.get('/api/v1/user/:userId/groups/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}

	// @ts-ignore
	const groups = await Group.find({ _id: { $in: user.groups } })
	// @ts-ignore
	const groupLabels: string[] = groups.map((group) => group.label)
	response.send({
		groupLabels,
		message: `User "${userId}" is in groups "${groupLabels.join('", "')}"`,
	})
})

// Add groups
app.post('/api/v1/user/:userId/groups/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}
	const groupLabels: string[] = request.body
	await Promise.all(
		groupLabels.map(async (groupLabel) => {
			const group = await Group.findOne({ label: groupLabel }).then(
				(g) => g || new Group({ label: groupLabel }).save()
			)
			// @ts-ignore
			await user.groups.push(group)
			return group
		})
	)
	await user.save()

	response.send({
		groupLabels,
		message: `User "${userId}" added to groups "${groupLabels.join('", "')}"`,
	})
})

// Remove groups
app.delete('/api/v1/user/:userId/groups/', (request, response) => {
	const groupLabels: string[] = request.body
	response.send({
		groupLabels,
		message: '@TODO',
	})
})

// Send to group
app.post('/api/v1/send/', async (request, response) => {
	const groupLabels: string[] = request.body.groupLabels
	const payload: string = request.body.payload
	const email: string = request.body.email
	const publicKey: string = request.body.publicKey
	const privateKey: string = request.body.privateKey

	webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey)

	const groups = await Group.find({ label: { $in: groupLabels } })

	const users = await User.find({
		groups: { $in: groups.map((g) => g._id) },
	})
	const devices = await Device.find({
		// @ts-ignore
		_id: { $in: [].concat(...users.map((u) => u.devices)) },
	})

	let successCount = 0
	let failCount = 0

	await Promise.all(
		devices.map(async (device) => {
			console.log('-----------------')
			console.log(device)
			await webpush
				// @ts-ignore
				.sendNotification(device.subscription, payload)
				.then(() => successCount++)
				.catch((error) => {
					console.log('Failed')
					console.error(error) // @TODO: maybe disable - too heavy
					failCount++
				})
		})
	)

	response.send({
		message: `Sent ${successCount} messages to groups "${groupLabels.join(
			'", "'
		)}" successfully and ${failCount} failed`,
	})
})
