require('esbuild').build({
	entryPoints: [
		'src/viewer.js',
		'src/loader.js',
		'src/points.js'
		// other files you want to end up in /static
	],
	format: 'esm',
	outdir: '../static/',
	bundle: true,
	splitting: true,
	minify: process.env.NODE_ENV === 'production', // only minify if production build
}).catch(err => {
	console.log(err);
	process.exit(1);
});