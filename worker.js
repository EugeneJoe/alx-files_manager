import Queue from 'bull';
import imageThumbnail from 'image-thumbnail';
import { promises as fs } from 'fs';
import { ObjectID } from 'mongodb';
import dbClient from './utils/db';

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

fileQueue.process(async function (job, done) {
    console.log('Processing...');
    const fileId = job.data.fileId;
    if (!fileId) {
	done(new Error('Missing fileId'));
    }

    const userId = job.data.userId
    if (!userId) {
	done(new Error('Missing userId'));
    }

    console.log(fileId, userId);
    const files = dbClient.db.collection('files');
    const idObject = new ObjectID(fileId);
    files.findOne({_id: idObject}, async (err, file) => {
	if (!file) {
	    console.log('Not found');
	    done(new Error('File not found'));
	} else {
	    const filename = file.localPath;
	    try {
		let imageFile = await fs.readFile(filename, 'ascii');
		const buff = Buffer.from(imageFile, 'ascii');
		imageFile = buff.toString('base64');
		const thumbnail_500 = await imageThumbnail(imageFile, {width: 500});
		const thumbnail_250 = await imageThumbnail(imageFile, {width: 250});
		const thumbnail_100 = await imageThumbnail(imageFile, {width: 100});
	    } catch (error) {
		console.log('thmbnail', error);
		done(error);
	    }
	    console.log('Writing files to system');
	    try {
		const image_500 = `${file.localPath}_500`;
		const image_250 = `${file.localPath}_250`;
		const image_100 = `${file.localPath}_100`;
		await fs.writeFile(image_500, thumbnail_500);
		await fs.writeFile(image_250, thumbnail_250);
		await fs.writeFile(image_100, thumbnail_100);
	    } catch (error) {
		console.log('file', error);
		done(error);
	    }
	    done();
	}
    });
});
