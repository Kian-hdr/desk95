import AppKit
let size = 1024
let image = NSImage(size:NSSize(width:size,height:size))
image.lockFocus()
NSColor(calibratedRed:0,green:0.5,blue:0.5,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:70,y:70,width:884,height:884),xRadius:170,yRadius:170).fill()
func rect(_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat,_ color:NSColor){color.setFill();NSBezierPath(rect:NSRect(x:x,y:y,width:w,height:h)).fill()}
let gray=NSColor(calibratedWhite:0.75,alpha:1),white=NSColor.white,dark=NSColor(calibratedWhite:0.16,alpha:1),navy=NSColor(calibratedRed:0,green:0,blue:0.5,alpha:1)
rect(200,318,624,494,dark);rect(200,330,612,482,white);rect(212,330,600,470,gray);rect(244,376,536,392,dark);rect(256,388,512,368,navy)
rect(310,664,220,26,white);rect(310,596,380,26,white);rect(310,528,310,26,white)
rect(438,242,148,76,dark);rect(450,254,124,64,gray);rect(286,206,452,46,dark);rect(286,220,440,32,white);rect(298,220,428,20,gray)
image.unlockFocus()
let dest=CommandLine.arguments[1]
let tiff=image.tiffRepresentation!, bitmap=NSBitmapImageRep(data:tiff)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:dest))
