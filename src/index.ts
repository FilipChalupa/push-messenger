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
	subscriptions: [
		{ type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
	],
	topics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }],
})

const subscriptionSchema = new mongoose.Schema({
	platform: String,
	data: Object,
})

const topicsSchema = new mongoose.Schema({
	label: {
		type: String,
		index: true,
		required: true,
	},
})

const User = mongoose.model('User', userSchema)
const Subscription = mongoose.model('Subscription', subscriptionSchema)
const Topics = mongoose.model('Topic', topicsSchema)

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

// Get subscriptions
app.post('/api/v1/user/:userId/subscriptions/', (request, response) => {
	// @TODO
	response.send({})
})

// Add subscription
app.post('/api/v1/user/:userId/subscription/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}
	const platform = request.body.platform || ''
	const data = request.body.data || {}
	const subscription = await new Subscription({ platform, data }).save()
	// @ts-ignore
	await user.subscriptions.push(subscription)
	await user.save()

	const subscriptionId = subscription._id

	response.send({
		subscriptionId,
		message: `Subscription with id "${subscriptionId}" added to user "${userId}"`,
	})
})

// Get topics
app.get('/api/v1/user/:userId/topics/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}

	// @ts-ignore
	const topics = await Topics.find({ _id: { $in: user.topics } })
	// @ts-ignore
	const topicLabels: string[] = topics.map((topic) => topic.label)
	response.send({
		topicLabels,
		message: `User "${userId}" is in topics "${topicLabels.join('", "')}"`,
	})
})

// Join topics
app.post('/api/v1/user/:userId/topics/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}
	const topicLabels: string[] = request.body
	await Promise.all(
		topicLabels.map(async (topicLabel) => {
			const topic = await Topics.findOne({ label: topicLabel }).then(
				(g) => g || new Topics({ label: topicLabel }).save()
			)
			// @ts-ignore
			await user.topics.push(topic)
			return topic
		})
	)
	await user.save()

	response.send({
		topicLabels,
		message: `User "${userId}" joined topics "${topicLabels.join('", "')}"`,
	})
})

// Leave topics
app.delete('/api/v1/user/:userId/topics/', async (request, response) => {
	const userId: string = request.params.userId
	const user = await User.findOne({ id: new mongoose.Types.ObjectId(userId) })
	if (!user) {
		throw new Error('User not found')
	}
	const topicLabels: string[] = request.body
	const topicToLeaveIds = (await Topics.find({
		label: { $in: topicLabels },
	})).map((topic) => topic._id)
	// @ts-ignore
	const remainingTopics = user.topics.filter(
		(topicId: string) => topicToLeaveIds.indexOf(topicId) === -1
	)
	// @ts-ignore
	user.topics = remainingTopics
	await user.save()
	response.send({
		topicLabels,
		message: `User "${userId}" left topics "${topicLabels.join('", "')}"`,
	})
})

// Send to topics
app.post('/api/v1/send/', async (request, response) => {
	const topicLabels: string[] = request.body.topics
	const forbiddenTopics: string[] = request.body.forbiddenTopics
	const payload: string = request.body.payload
	const email: string = request.body.email
	const publicKey: string = request.body.publicKey
	const privateKey: string = request.body.privateKey

	webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey)

	const topics = await Topics.find({ label: { $in: topicLabels } })

	const users = await User.find({
		topics: { $in: topics.map((g) => g._id) },
	})
	const subscriptions = await Subscription.find({
		// @ts-ignore
		_id: { $in: [].concat(...users.map((u) => u.subscriptions)) },
	})

	let successCount = 0
	let failCount = 0

	await Promise.all(
		subscriptions.map(async (subscription) => {
			await webpush
				// @ts-ignore
				.sendNotification(subscription.data, payload)
				.then(() => successCount++)
				.catch(() => failCount++)
		})
	)

	response.send({
		message: `Sent ${successCount} messages to topics "${topicLabels.join(
			'", "'
		)}" successfully and ${failCount} failed`,
	})
})
