/**
 * Media Viewer paging
 * https://github.com/electricgoat/wiki_gallery_enhancements
 *
 * Smoother paging through images in Media Viewer:
 *
 * - An image that has already been loaded is shown straight away. Media Viewer hands it
 *   over through an asynchronous promise, so a placeholder flickers for a frame.
 * - While an image is still loading, its placeholder is shown at full size, as Media Viewer
 *   intended. The brief small image seems to be a bug in MW (see also MediaViewerPaging.css).
 * - The previous image is preloaded along with the next one, which Media Viewer already does.
 * - Images load without CORS; otherwise a resized image that hasn't been made yet fails to 
 *   load ("Sorry, the file cannot be displayed").
 */
// Nothing to load: this only provides require(), to reach Media Viewer's classes as it opens
mw.loader.using( [] ).then( ( require ) => {
	'use strict';

	let patched = false;

	/**
	 * Show the image now if Media Viewer has it loaded already.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being opened
	 * @return {boolean} Whether the image was shown
	 */
	function showLoadedImage( viewer, image ) {
		const widths = viewer.ui.canvas.getCurrentImageWidths();
		const ext = image.filePageTitle.getExtension().toLowerCase();
		let width = widths.real;
		// Same clamping as MultimediaViewer#fetchThumbnail, so these lookups hit its caches
		if ( ext !== 'svg' && image.originalWidth && width > image.originalWidth ) {
			width = image.originalWidth;
		}
		let shown = false;
		const thumbnailPromise = viewer.thumbnailInfoProvider.get( image.filePageTitle, image.src, width );
		if ( thumbnailPromise.state() === 'resolved' ) {
			// done() on a resolved jQuery promise runs synchronously
			thumbnailPromise.done( ( thumbnail ) => {
				const imagePromise = viewer.imageProvider.get( thumbnail.url );
				if ( imagePromise.state() === 'resolved' ) {
					imagePromise.done( ( element ) => {
						// As MultimediaViewer#loadImage does once the image arrives; it then finds it already in place
						element.className = 'mw-mmv-final-image ' + ext;
						element.alt = image.alt;
						viewer.realThumbnailShown = true;
						viewer.setImage( thumbnail, element, widths );
						shown = true;
					} );
				}
			} );
		}
		return shown;
	}

	/**
	 * Size the placeholder. Media Viewer skips this when paging, because it checks whether the
	 * previous image was shown before resetting that flag for the new one.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being opened
	 */
	function sizePlaceholder( viewer, image ) {
		const $placeholder = viewer.ui.canvas.$image;
		if ( $placeholder && $placeholder.hasClass( 'mw-mmv-placeholder-image' ) && !$placeholder[ 0 ].style.width ) {
			viewer.displayPlaceholderThumbnail( image, $placeholder, viewer.ui.canvas.getCurrentImageWidths() );
		}
	}

	/**
	 * Load the images either side of the one being shown, wrapping around like the viewer does.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being shown
	 */
	function preloadNeighbours( viewer, image ) {
		const thumbs = viewer && viewer.isOpen && viewer.thumbs;
		// Media Viewer also reports images whose details arrive after another was opened
		if ( !thumbs || thumbs.length < 2 || viewer.currentImage !== image || typeof viewer.fetchThumbnail !== 'function' ) {
			return;
		}
		// Speculative downloads (a sprite can be ~0.7 MB): skip when the reader asked to save data
		if ( navigator.connection && navigator.connection.saveData ) {
			return;
		}
		[ -1, 1 ].forEach( ( step ) => {
			const neighbour = thumbs[ ( image.index + step + thumbs.length ) % thumbs.length ];
			viewer.fetchThumbnail( neighbour, viewer.ui.canvas.getLightboxImageWidths( neighbour ).real );
			viewer.fetchSizeIndependentLightboxInfo( neighbour.filePageTitle );
		} );
	}

	/**
	 * Load images without CORS. Media Viewer requests them with crossOrigin = 'anonymous', which
	 * only lets scripts read their pixels, and nothing currently uses that. Cache miss on a thumb
	 * is redirected to /w/thumb_handler.php, which sends no Access-Control-Allow-Origin header,
	 * so the browser blocks it under CORS. Without CORS, images load like all others on the page.
	 *
	 * @param {Function} ImageProvider Media Viewer's ImageProvider class
	 */
	function loadWithoutCors( ImageProvider ) {
		// Its only use left is choosing CORS (it was for an XHR preloader that has since been removed)
		if ( ImageProvider && typeof ImageProvider.prototype.imagePreloadingSupported === 'function' ) {
			ImageProvider.prototype.imagePreloadingSupported = () => false;
		}
	}

	/**
	 * Hook Media Viewer as it first opens, before it loads that image. The loadImage hook acts from the
	 * next image on: the paging bugs only show once an image has been displayed.
	 */
	function patchViewer() {
		// The classic viewer is loaded by now; if it isn't (mobile beta viewer), leave things be
		if ( patched || mw.loader.getState( 'mmv' ) !== 'ready' ) {
			return;
		}
		patched = true;
		// This runs inside Media Viewer's loadImage: an error here must not stop the viewer
		try {
			const mmv = require( 'mmv' );
			loadWithoutCors( mmv.ImageProvider );
			const MultimediaViewer = mmv.MultimediaViewer;
			const loadImage = MultimediaViewer && MultimediaViewer.prototype.loadImage;
			if ( typeof loadImage !== 'function' ) {
				return;
			}
			MultimediaViewer.prototype.loadImage = function ( image ) {
				const result = loadImage.apply( this, arguments );
				try {
					if ( !showLoadedImage( this, image ) ) {
						sizePlaceholder( this, image );
					}
				} catch ( e ) {
					mw.log.error( e );
				}
				return result;
			};
		} catch ( e ) {
			mw.log.error( e );
		}
	}

	$( document )
		.on( 'mmv-setup-overlay', patchViewer )
		// Fired once the current image and its details have loaded
		.on( 'mmv-metadata', ( e ) => {
			try {
				preloadNeighbours( e.viewer, e.image );
			} catch ( err ) {
				mw.log.error( err );
			}
		} );
} );
