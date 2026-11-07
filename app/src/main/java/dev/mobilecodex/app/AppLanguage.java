package dev.mobilecodex.app;

import android.content.Context;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.*;
import dev.mobilecodex.app.core.Texts;
import static dev.mobilecodex.app.core.Json.*;

final class AppLanguage {
    private static Map<String, String> english = Map.of();
    static void initialize(Context context) {
        try (var stream = context.getAssets().open("translations-en.json")) {
            var bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            JSONObject json = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            var values = new HashMap<String, String>();
            for (var keys = json.keys(); keys.hasNext();) { String key = keys.next(); values.put(key, json.getString(key)); }
            english = Map.copyOf(values);
        } catch (Exception failure) { android.util.Log.e("AppLanguage", "Unable to load bundled translations", failure); }
        configure(context);
    }
    static String choice(Context context) { return "en"; }
    static Locale locale(Context context) { return Locale.ENGLISH; }
    static void configure(Context context) { Texts.configure(false, english); }
    static JSONObject snapshot(Context context) { return obj("choice", "en", "systemLanguage", "en"); }
    @android.annotation.SuppressLint("ApplySharedPref")
    static void set(Context context, String value) throws java.io.IOException {
        if (!"en".equals(value)) throw new IllegalArgumentException("Only English is supported");
        if (!context.getSharedPreferences("appearance", 0).edit().putString("language", "en").commit()) throw new java.io.IOException("Unable to save language setting");
        configure(context);
        UsageWidgetProvider.updateAll(context);
    }
}
