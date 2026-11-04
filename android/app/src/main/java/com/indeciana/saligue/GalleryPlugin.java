package com.indeciana.saligue;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Saves a downloaded picture or video straight into the phone's gallery (Pictures/Saligue or Movies/Saligue),
 * like TikTok's "Save video". Android 10 and newer; older phones use the share menu instead (see save-file.ts).
 */
@CapacitorPlugin(name = "Gallery")
public class GalleryPlugin extends Plugin {

    @PluginMethod
    public void saveFromUrl(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "saligue");
        String mime = call.getString("mime", "image/jpeg");
        String auth = call.getString("auth");
        if (url == null || !url.startsWith("https://")) {
            call.reject("bad_url");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            Uri item = null;
            ContentResolver resolver = getContext().getContentResolver();
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(120000);
                if (auth != null && !auth.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + auth);
                int status = conn.getResponseCode();
                if (status != 200) {
                    call.reject(status == 429 ? "too_many_downloads" : "http_" + status);
                    return;
                }
                boolean video = mime.startsWith("video/");
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Saligue");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                item = resolver.insert(collection, values);
                if (item == null) {
                    call.reject("no_gallery");
                    return;
                }
                try (InputStream in = conn.getInputStream(); OutputStream out = resolver.openOutputStream(item)) {
                    byte[] buffer = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(item, values, null, null);
                JSObject result = new JSObject();
                result.put("uri", item.toString());
                call.resolve(result);
            } catch (Exception e) {
                if (item != null) try { resolver.delete(item, null, null); } catch (Exception ignored) { }
                call.reject("failed", e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
