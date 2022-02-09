import sha1 from 'sha1';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';
import { ObjectID } from 'mongodb';

class UsersController {
    static postNew(request, response) {
	const email = request.body.email;
	const password = request.body.password;

	if (!email) {
	    response.status(400).json({"error": 'Missing email'});
	    return;
	}
	if (!password) {
	    response.status(400).json({"error": 'Missing password'});
	    return;
	}

	const users = dbClient.db.collection('users');
	users.findOne({email: email}, (err, user) => {
	    if (user) {
		response.status(400).json({"error": 'Already exist'});
		return;
	    } else {
		const hashedPassword = sha1(password);
		users.insertOne(
		    {
			email: email,
			password: hashedPassword
		    }
		).then(result => response.status(201).json({"id": result.insertedId, "email": email}))
		    .catch(error => console.log(error));
	    }
	});
    }

    static async getMe(request, response) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	if (userId) {
	    const users = dbClient.db.collection('users');
	    const idObject = new ObjectID(userId);
	    users.findOne({_id: idObject}, (err, user) => {
		if (user) {
		    response.status(200).json({"id": userId, "email": user.email});
		} else {
		    response.status(401).json({"error": "Unauthorized"});
		}
	    });
	} else {
	    console.log('Hupatikani!');
	    response.status(401).json({"error": "Unauthorized"});
	}
    }
}

module.exports = UsersController;
