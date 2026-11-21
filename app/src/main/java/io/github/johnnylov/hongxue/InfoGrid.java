package io.github.johnnylov.hongxue;

import android.graphics.Bitmap;
import android.graphics.Rect;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Locate the information panel's icon rows before reading individual captions.
 * Geometry and colour thresholds adapted from the desktop BanIconGrid (Apache-2.0). */
final class InfoGrid {
    final Rect label;
    final boolean banned;
    private InfoGrid(Rect label,boolean banned){this.label=label;this.banned=banned;}

    static List<InfoGrid> find(Bitmap image,Rect screen){
        List<InfoGrid> slots=new ArrayList<>();
        int w=(int)(screen.width()*.69),h=screen.height();
        int[] rgb=new int[w*h];image.getPixels(rgb,0,w,screen.left,screen.top,w,h);
        int top=-1;
        for(int y=h/7;y<h*.94;y++){
            int count=0;
            for(int x=0;x<w;x+=2)if(light(rgb[y*w+x]))count++;
            if(count>w*.025){if(top<0)top=y;continue;}
            if(top<0)continue;
            int height=y-top;
            if(height>=h*.05 && height<=h*.13){
                List<Integer> xs=new ArrayList<>();int start=-1;
                for(int x=0;x<w;x++){
                    int bright=0;
                    for(int row=top;row<y;row+=2)if(light(rgb[row*w+x]))bright++;
                    if(bright>1){if(start<0)start=x;continue;}
                    if(start>=0 && x-start>screen.width()*.025)xs.add((start+x)/2);
                    start=-1;
                }
                if(xs.size()>=4){
                    List<Integer> gaps=new ArrayList<>();
                    for(int i=1;i<xs.size();i++)gaps.add(xs.get(i)-xs.get(i-1));
                    Collections.sort(gaps);int pitch=gaps.get((gaps.size()-1)/2);
                    if(pitch>screen.width()*.039 && pitch<screen.width()*.095){
                        for(int cx:xs){
                            int half=(int)(.30*pitch),green=0,total=0;
                            for(int j=top;j<y;j+=2)for(int x=Math.max(0,cx-half);x<Math.min(w,cx+half);x+=2){
                                int color=rgb[j*w+x],r=color>>16&255,g=color>>8&255,b=color&255;
                                if(g>90 && g*10>r*13 && g*10>b*13)green++;
                                total++;
                            }
                            int left=screen.left+cx-(int)(pitch*.475),labelY=screen.top+y+(int)(height*.02);
                            slots.add(new InfoGrid(new Rect(left,labelY,left+(int)(pitch*.95),labelY+(int)(height*.45)),green<total*.15));
                        }
                    }
                }
            }
            top=-1;
        }
        return slots;
    }
    private static boolean light(int c){return (((c>>16&255)*77+(c>>8&255)*150+(c&255)*29)>>8)>60;}
}
