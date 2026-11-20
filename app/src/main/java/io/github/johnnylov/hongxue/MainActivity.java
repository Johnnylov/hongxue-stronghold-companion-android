package io.github.johnnylov.hongxue;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.io.OutputStream;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private int fileRequest;
    private MirrorReceiver mirror;

    private void mirrorEvent(String event,Object value) {
        String arg=value instanceof JSONObject ? value.toString() : JSONObject.quote(String.valueOf(value));
        web.evaluateJavascript("window.PhoneMirror && PhoneMirror.event("+JSONObject.quote(event)+","+arg+")",null);
    }
    private void stopMirror() {
        MirrorReceiver old=mirror;mirror=null;
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(old!=null){old.close();mirrorEvent("off","已停止接收");}
    }
    @Override protected void onStop(){stopMirror();super.onStop();}

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(29, 37, 43));
        getWindow().setNavigationBarColor(Color.rgb(29, 37, 43));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(244, 242, 235));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new DeviceActions(), "Tablet");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (req.isForMainFrame() && "https".equals(uri.getScheme()) && uri.getPath() != null &&
                    (("game.skland.com".equals(uri.getHost()) && uri.getPath().startsWith("/arknights/stronghold-guide"))
                    || ("github.com".equals(uri.getHost()) && "/Johnnylov/hongxue-stronghold-companion-android/releases".equals(uri.getPath())))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException unavailable) {
                        Toast.makeText(MainActivity.this, "请先安装浏览器以打开森空岛", Toast.LENGTH_LONG).show();
                    }
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String path = uri.getPath();
                if (!"GET".equals(req.getMethod()) || !"https".equals(uri.getScheme()) ||
                    !HOST.equals(uri.getHost()) || path == null || path.contains("..")) return error(403, "Forbidden");
                if ("/api/guide".equals(path) || "/api/paste".equals(path)) return fetchGuide(uri.getQueryParameter("id"), path.endsWith("paste"));
                try {
                    String name = path.substring(1);
                    String mime = name.endsWith(".js") ? "application/javascript" :
                        name.endsWith(".css") ? "text/css" : name.endsWith(".webp") ? "image/webp" :
                        name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".dll") ? "application/octet-stream" :
                        name.endsWith(".json") ? "application/json" : name.endsWith(".html") ? "text/html" : "text/plain";
                    return new WebResourceResponse(mime, mime.startsWith("image/") ? null : "UTF-8", getAssets().open(name));
                } catch (IOException missing) { return error(404, "Not Found"); }
            }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html");
    }

    public final class DeviceActions {
        @JavascriptInterface public void phoneMirror(boolean start) {
            runOnUiThread(()->{
                if(!start){stopMirror();return;}
                if(mirror!=null)return;
                try {
                    mirror=new MirrorReceiver(MainActivity.this,(source,event,value)->runOnUiThread(()->{
                        if(source!=mirror)return;
                        if("error".equals(event))stopMirror();
                        mirrorEvent(event,value);
                    }));
                    mirror.start();
                    getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }catch(Exception | LinkageError e){stopMirror();mirrorEvent("error","无法启动接收："+e.getMessage());}
            });
        }
        @JavascriptInterface public void chromeColor(String color) {
            if(color!=null && color.matches("#[a-fA-F0-9]{6}"))runOnUiThread(()->{
                int value=Color.parseColor(color);getWindow().setStatusBarColor(value);getWindow().setNavigationBarColor(value);
            });
        }
        @JavascriptInterface public void readClipboard(int id) {
            runOnUiThread(()->{
                try{
                    ClipboardManager manager=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                    ClipData clip=manager.getPrimaryClip();
                    CharSequence text=clip!=null&&clip.getItemCount()>0?clip.getItemAt(0).getText():null;
                    inputResult(id,text==null?"":text.toString(),"");
                }catch(SecurityException unavailable){inputResult(id,"","请允许读取剪贴板，再试一次");}
            });
        }
        @JavascriptInterface public void openJson(int id) {
            runOnUiThread(()->{
                fileRequest=id;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                  .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
                try{startActivityForResult(intent,71);}catch(ActivityNotFoundException e){inputResult(id,"","这台设备没有文件选择器");}
            });
        }
        @JavascriptInterface public void copy(String text) {
            runOnUiThread(() -> ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE))
                .setPrimaryClip(ClipData.newPlainText("马头·卫戍手册", text)));
        }
        @JavascriptInterface public void share(String text) {
            runOnUiThread(() -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND)
                .setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "分享阵容")));
        }
        @JavascriptInterface public void publishPaste(String text) {
            if (text == null || text.length() > 300000) { publishResult("", "阵容太大，无法生成链接"); return; }
            new Thread(() -> {
                HttpsURLConnection connection = null;
                try {
                    connection = (HttpsURLConnection)new URL("https://dpaste.com/api/v2/").openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
                    connection.setRequestMethod("POST"); connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    byte[] body = ("syntax=json&expiry_days=365&content=" + URLEncoder.encode(text,"UTF-8")).getBytes(StandardCharsets.UTF_8);
                    try (OutputStream out=connection.getOutputStream()) { out.write(body); }
                    if (connection.getResponseCode()/100!=2) throw new IOException("HTTP");
                    try (java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                        String link=reader.readLine();
                        if(link==null || !link.matches("https://dpaste\\.com/[a-zA-Z0-9]+/?")) throw new IOException("link");
                        publishResult(link, "");
                    }
                } catch(IOException e) { publishResult("", "分享服务暂时不可用，可使用系统分享 JSON"); }
                finally { if(connection!=null)connection.disconnect(); }
            }).start();
        }
        private void publishResult(String link,String message) {
            runOnUiThread(() -> web.evaluateJavascript("window.pastePublished("+JSONObject.quote(link)+","+JSONObject.quote(message)+")",null));
        }
    }

    private void inputResult(int id,String text,String error) {
        runOnUiThread(()->web.evaluateJavascript("PointControls.accept("+id+","+JSONObject.quote(text)+","+JSONObject.quote(error)+")",null));
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request!=71 || result!=RESULT_OK || data==null || data.getData()==null)return;
        final Uri uri=data.getData();final int id=fileRequest;
        new Thread(()->{
            try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){
                if(in==null)throw new IOException("empty");
                byte[] buf=new byte[8192];int read;
                while((read=in.read(buf))!=-1){if(out.size()+read>6*1024*1024){inputResult(id,"","文件超过 6 MB");return;}out.write(buf,0,read);}
                inputResult(id,out.toString("UTF-8"),"");
            }catch(IOException | SecurityException e){inputResult(id,"","无法读取所选文件");}
        }).start();
    }
    private static WebResourceResponse fetchGuide(String id, boolean paste) {
        if (id == null || !id.matches(paste ? "[A-Za-z0-9]{1,32}" : "[0-9]{1,30}")) return error(400, "Bad Request");
        HttpsURLConnection connection = null;
        try {
            URL url = new URL(paste ? "https://dpaste.com/" + id + ".txt" : "https://zonai.skland.com/web/v1/game/garrison/guide/info?guideId=" + id + "&hostNeedEditing=true");
            connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            if(!paste) {
                connection.setRequestProperty("Referer", "https://game.skland.com/");
                connection.setRequestProperty("Origin", "https://game.skland.com");
            }
            if (connection.getResponseCode() != 200) return error(502, "Guide Unavailable");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    if (output.size() + length > 4 * 1024 * 1024) return error(413, "Too Large");
                    output.write(buffer, 0, length);
                }
                return new WebResourceResponse("application/json", "UTF-8", 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(output.toByteArray()));
            }
        } catch (IOException unavailable) { return error(503, "Network Unavailable"); }
        finally { if (connection != null) connection.disconnect(); }
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.handleBack ? window.handleBack() : false", handled -> {
            if (!"true".equals(handled)) super.onBackPressed();
        });
    }
}
