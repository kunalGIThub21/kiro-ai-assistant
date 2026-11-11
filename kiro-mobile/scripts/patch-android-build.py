import re
import os
import sys

def patch_build_gradle():
    build_gradle_path = os.path.join("android", "app", "build.gradle")
    if not os.path.exists(build_gradle_path):
        print(f"Error: {build_gradle_path} not found!")
        sys.exit(1)

    with open(build_gradle_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Ensure active debuggableVariants = [] in react {
    if not re.search(r'^\s*debuggableVariants\s*=\s*\[\]', content, re.MULTILINE):
        content = re.sub(r'(react\s*\{)', r'\1\n    debuggableVariants = []', content)
        print("Injected 'debuggableVariants = []' into react {} block.")
    else:
        print("'debuggableVariants = []' already set.")

    # 2. Ensure release block has signingConfig signingConfigs.debug
    if not re.search(r'release\s*\{[^}]*signingConfig\s+signingConfigs\.debug', content):
        content = re.sub(
            r'(release\s*\{)',
            r'\1\n            signingConfig signingConfigs.debug',
            content
        )
        print("Injected 'signingConfig signingConfigs.debug' into release buildType.")
    else:
        print("Release signingConfig already configured.")

    # 3. Disable proguard minification to avoid missing symbol issues
    content = content.replace("minifyEnabled enableProguardInReleaseBuilds", "minifyEnabled false")

    with open(build_gradle_path, "w", encoding="utf-8") as f:
        f.write(content)

    print("android/app/build.gradle successfully patched.")

if __name__ == "__main__":
    patch_build_gradle()
