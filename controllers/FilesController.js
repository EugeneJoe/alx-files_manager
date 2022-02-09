import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { ObjectID } from 'mongodb';
import mime from 'mime-types';
import Queue from 'bull';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

class FilesController {
    static async getUser(request) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	if (userId) {
	    const users = dbClient.db.collection('users');
	    const idObject = new ObjectID(userId);
	    const user = await users.findOne({_id: idObject});
	    if (!user) {
		return null;
	    } else {
		return user;
	    }
	}
    }

    static async postUpload(request, response) {
	const user = await FilesController.getUser(request);
	console.log(user);
	if (!user) {
	    console.log('Hauko', user);
	    response.status(401).json({"error": "Unauthorized"});
	    return;
	} else {
	    const name = request.body.name;
	    const type = request.body.type;
	    const parentId = request.body.parentId;
	    const isPublic = request.body.isPublic || false;
	    const data = request.body.data;

	    if (!name) {
		response.status(400).json({"error": "Missing name"});
		return;
	    }
	    if (!type) {
		response.status(400).json({"error": "Missing type"});
		return;
	    }
	    if (type != 'folder' && !data) {
		response.status(400).json({"error": "Missing data"});
		return;
	    }

	    const files = dbClient.db.collection('files');
	    if (parentId) {
		const idObject = new ObjectID(parentId);
		files.findOne({_id: idObject, userId: user._id}, (err, file) => {
		    if (!file) {
			response.status(400).json({"error": "Parent not found"});
			return;
		    } else {
			if (file.type !== 'folder') {
			    console.log(file.type);
			    response.status(400).json({"error": "Parent is not a folder"});
			    return;
			}
		    }
		});
	    }
	    if (type === 'folder') {
		files.insertOne(
		    {
			userId: user._id,
			name: name,
			type: type,
			parentId: parentId || 0,
			isPublic: isPublic
		    }
		).then((result) => {
		    response.status(201).json({
			"id": result.insertedId,
			"userId": user._id,
			"name": name,
			"type": type,
			"isPublic": isPublic,
			"parentId": parentId || 0
		    });
		    return;
		}).catch((error) => {
		    console.log(error)
		    return;
		});
	    } else {
		const filePath = process.env.FOLDER_PATH || '/tmp/files_manager';
		const fileName = `${filePath}/${uuidv4()}`;
		const buff = new Buffer.from(data, 'base64');
		const storeThis = buff.toString('utf-8');
		try {
		    try {
			await fs.mkdir(filePath);
		    } catch (error) {
			//pass. Error raised when file already exists
		    }
		    await fs.writeFile(fileName, storeThis);
		} catch (error) {
		    console.log(error);
		}
		files.insertOne(
		    {
			userId: user._id,
			name: name,
			type: type,
			isPublic: isPublic,
			parentId: parentId || 0,
			localPath: fileName
		    }
		).then((result) => {
		    response.status(201).json({
			"id": result.insertedId,
			"userId": user._id,
			"name": name,
			"type": type,
			"isPublic": isPublic,
			"parentId": parentId || 0
		    });
		    if (type === 'image') {
			fileQueue.add(
			    {
				'userId': user._id,
				'fileId': result.insertedId
			    }
			);
		    }
		    return;
		}).catch(error => console.log(error));
	    }
	}
    }

    static async getShow(request, response) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	const user = await FilesController.getUser(request);
	if (!user) {
	    response.status(401).json({"error": "Unauthorized"});
	    return;
	} else {
	    const fileId = request.params.id;
	    const files = dbClient.db.collection('files');
	    const idObject = new ObjectID(fileId);
	    files.findOne({_id: idObject, userId: user._id}, (err, file) => {
		if (!file) {
		    response.status(404).json({"error": "Not found"});
		    return;
		} else {
		    response.status(200).json(file);
		    return;
		}
	    });
	}
    }

    static async getIndex(request, response) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	const user = await FilesController.getUser(request);
	if (!user) {
	    response.status(401).json({"error": "Unauthorized"});
	    return;
	} else {
	    const parentId = request.param('parentId', 0);
	    const page = request.param('page', 1);
	    const files = dbClient.db.collection('files');
	    files.aggregate(
		[
		    { "$match": {parentId: parentId, userId: user._id} },
		    { "$sort": { _id: -1 }},
		    { "$facet": {
			metadata: [{ "$count": "total"}, { "$addFields": { "page": parseInt(page) - 1} }],
			data: [{ "$skip": 20 * (parseInt(page) - 1) }, {"$limit": 20}]
		    } }
		]
	    ).toArray((err, result) => {
		if (result) {
		    response.status(200).json(result[0].data);
		    return;
		}
	    });
	}
    }

    static async putPublish(request, response) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	const user = await FilesController.getUser(request);
	if (!user) {
	    response.status(401).json({"error": "Unauthorized"});
	    return;
	} else {
	    const id = request.params.id;
	    const files = dbClient.db.collection('files');
	    const idObject = new ObjectID(id);
	    const newValue = { "$set": { isPublic: true } };
	    files.findOneAndUpdate({_id: idObject, userId: user._id}, newValue, { returnOriginal: false }, (err, file) => {
		if (!file) {
		    response.status(401).json({"error": "Not found"});
		    return;
		} else {
		    response.status(200).json(file.value);
		    return;
		}
	    });
	}
    }

    static async putUnpublish(request, response) {
	const token = request.header('X-Token');
	const key = `auth_${token}`;
	const userId = await redisClient.get(key);
	const user = await FilesController.getUser(request);
	if (!user) {
	    response.status(401).json({"error": "Unauthorized"});
	    return;
	} else {
	    const id = request.params.id;
	    const files = dbClient.db.collection('files');
	    const idObject = new ObjectID(id);
	    const newValue = { "$set": { isPublic: false } };
	    files.findOneAndUpdate({_id: idObject, userId: user._id}, newValue, {returnOriginal: false}, (err, file) => {
		if (!file) {
		    response.status(401).json({"error": "Not found"});
		    return;
		} else {
		    response.status(200).json(file.value);
		    return;
		}
	    });
	}
    }

    static async getFile(request, response) {
	const id = request.params.id;
	const files = dbClient.db.collection('files');
	const idObject = new ObjectID(id);
	files.findOne({_id: idObject}, async (err, file) => {
	    if (!file) {
		response.status(404).json({"error": "Not found"});
		return
	    } else {
		console.log(file._id, file.name, file.type, file.userId);
		if (file.type === 'folder') {
		    response.status(400).json({"error": "A folder doesn't have content"});
		    return;
		} else {
		    console.log(file.localPath);
		    if (file.isPublic) {
			try {
			    const fileName = file.localPath;
			    const size = request.param('size')
			    if (size) {
				const fileName = `${file.localPath}_${size}`;
			    }
			    const data = await fs.readFile(fileName);
			    const contentType = mime.contentType(file.name);
			    response.header('Content-Type', contentType).status(200).send(data);
			} catch(error) {
			    console.log(error);
			    response.status(404).json({"error": "Not found"});
			    return;
			}
		    } else {
			const user = await FilesController.getUser(request);
			if (!user) {
			    response.status(404).json({"error": "Not found"});
			    return;
			} else {
			    if (file.userId.toString() === user._id.toString()) {
				try {
				    let fileName = file.localPath;
				    const size = request.param('size')
				    if (size) {
					fileName = `${file.localPath}_${size}`;
				    }
				    const data = await fs.readFile(fileName);
				    const contentType = mime.contentType(file.name);
				    response.header('Content-Type', contentType).status(200).send(data);
				} catch(error) {
				    console.log(error);
				    response.status(404).json({"error": "Not found"});
				    return;
				}
			    } else {
				console.log(`Wrong user: file.userId=${file.userId}; userId=${user._id}`);
				response.status(404).json({"error": "Not found"});
				return;
			    }
			}
		    }
		}
	    }
	});
    }
}

module.exports = FilesController;
