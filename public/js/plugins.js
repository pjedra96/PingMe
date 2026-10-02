$(document).ready(function(){
    
//	var alphabet = "abcdef".split("");
//	alphabet.each(function(letter) {
////	  $('.emotion-area').append('<img scr="img/1f60${letter}.png"');
//		console.log(letter);
//	});
	
	function ApndImgEmotion() {
		for (var i = 65; i <= 70; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f60' + String.fromCharCode(i).toLowerCase() + '.png">' + 
				'<img width="20px" height="20px" src="img/1f61' + String.fromCharCode(i).toLowerCase() + '.png">' + 
				'<img width="20px" height="20px" src="img/1f62' + String.fromCharCode(i).toLowerCase() + '.png">' + 
				'<img width="20px" height="20px" src="img/1f47' + String.fromCharCode(i).toLowerCase() + '.png">' +
				'<img width="20px" height="20px" src="img/1f49' + String.fromCharCode(i).toLowerCase() + '.png">'
			);
		}
		
		for (var i = 4; i <= 8; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f32' + i + '.png">'
			);
		}
		
		for (var i = 3; i <= 8; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f49' + i + '.png">'
			);
		}
		
		for (var i = 0; i <= 9; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f60' + i + '.png">'
			);
		}
		
		for (var i = 10; i <= 44; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f6' + i + '.png">'
			);
		}
		
		for (var i = 10; i <= 17; i++) {
			$('.emotion-area').append(
				'<img width="20px" height="20px" src="img/1f9' + i + '.png">'
			);
		}
	}
	
//	$(document).one('click' , '.emotion-Icon', function(e){
//		ApndImgEmotion();
//	});
	
	$(document).on('click' , '.emotion-Icon', function(e){
		var top = $(this).offset().top ,
			top = Math.floor(top),
			emotionArea = $(this).find('.emotion-area');
		
		emotionArea.toggleClass('ShowImotion');
		
		if( top <= 160 ){
			emotionArea.toggleClass('top');
		}
		
		if(!emotionArea.hasClass('ShowImotion')){
			$('.emotion-area').empty();
			emotionArea.removeClass('top');
		}else{
			ApndImgEmotion();
		}
		
	});
	
	$(document).on('click', '.emotion-area' ,function(e){
		e.stopPropagation();
	});
	
	// Weather symbols (U+1F321-U+1F328) render as plain text unless followed by the emoji variation selector
	function emojiFromImg(src) {
		var hex = src.match(/([0-9a-f]+)\.png$/i)[1];
		var codePoint = parseInt(hex, 16);
		var emoji = String.fromCodePoint(codePoint);
		if (codePoint >= 0x1F321 && codePoint <= 0x1F328) {
			emoji += '️';
		}
		return emoji;
	}

	$(document).on('click' , '.emotion-area img', function(e){
		// Insert the Unicode emoji at the cursor position of the message textarea
		var msgInput = document.getElementById('msgInput');
		msgInput.focus();
		msgInput.setRangeText(emojiFromImg($(this).attr('src')), msgInput.selectionStart, msgInput.selectionEnd, 'end');
		msgInput.dispatchEvent(new Event('input')); // Triggers the "is typing" notification

		// Once the emoji is selected, close the emoji picker window
		$(this).parent().toggleClass('ShowImotion');
		//$('#txt').focus();
	});

	// Pepople online window
	$(document).on('click' , '.people', function(e){
		var top = $(this).offset().top ,
			top = Math.floor(top),
		 	people = $(this).find('.people-online');
		
		people.toggleClass('ShowImotion');
		
		if( top <= 160 ){
			people.toggleClass('top');
		}
		
		if(!people.hasClass('ShowImotion')){
			people.removeClass('top');
		}
	});
});













