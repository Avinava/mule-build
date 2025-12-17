#!/bin/bash

# Mule Application Build Script (adapted for this project)
# Usage: ./build.sh [sandbox|production] [version]
# - sandbox: removes secure:: prefixes and removes secure-properties config for local/sandbox deploys
# - production: preserves secure properties; optionally enforce secure prefixes via --enforce-secure
# Example: ./build.sh sandbox
#          ./build.sh production 1.2.0

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Globals
ENVIRONMENT=""
VERSION=""
TARGET_DIR="target"
BACKUP_DIR="backup"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME=""
ENFORCE_SECURE=false

# Try to source the legacy config utilities if present
if [ -f "$ROOT_DIR/legacy/config-utils.sh" ]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/legacy/config-utils.sh"
fi

# Printing helpers
print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
  echo "Usage: $0 [sandbox|production] [version] [--enforce-secure]"
  echo ""
  echo "Arguments:"
  echo "  environment      Target environment (sandbox or production)"
  echo "  version          Optional: Package version (defaults to pom.xml version)"
  echo "  --enforce-secure Optional: For production, enforce secure:: prefixes for sensitive properties"
  echo ""
  echo "Examples:"
  echo "  $0 sandbox"
  echo "  $0 production 1.2.0"
  echo "  $0 production --enforce-secure"
}

get_project_name_from_pom() {
  # Prefer <name>, fallback to <artifactId>
  local name
  local artifact
  name=$(grep -m1 -E '<name>.*</name>' pom.xml | sed 's/.*<name>\(.*\)<\/name>.*/\1/' || true)
  artifact=$(grep -m1 -E '<artifactId>.*</artifactId>' pom.xml | sed 's/.*<artifactId>\(.*\)<\/artifactId>.*/\1/' || true)
  if [ -n "$name" ]; then
    echo "$name"
  elif [ -n "$artifact" ]; then
    echo "$artifact"
  else
    echo "mule-app"
  fi
}

backup_files() {
  print_info "Creating backup of original files..."
  mkdir -p "$BACKUP_DIR"
  mkdir -p "$BACKUP_DIR/implementation"
  
  # Backup global.xml and pom.xml
  cp src/main/mule/global.xml "$BACKUP_DIR/global.xml.bak"
  cp pom.xml "$BACKUP_DIR/pom.xml.bak"
  
  # Backup implementation files that contain secure:: references
  if [ -d "src/main/mule/implementation" ]; then
    while IFS= read -r -d '' file; do
      if grep -q "secure::" "$file" 2>/dev/null; then
        local filename
        filename=$(basename "$file")
        cp "$file" "$BACKUP_DIR/implementation/${filename}.bak"
      fi
    done < <(find src/main/mule/implementation -type f -name "*.xml" -print0)
  fi
}

restore_files() {
  print_info "Restoring original files..."
  
  # Restore global.xml and pom.xml
  if [ -f "$BACKUP_DIR/global.xml.bak" ]; then
    cp "$BACKUP_DIR/global.xml.bak" src/main/mule/global.xml
  fi
  if [ -f "$BACKUP_DIR/pom.xml.bak" ]; then
    cp "$BACKUP_DIR/pom.xml.bak" pom.xml
  fi
  
  # Restore implementation files
  if [ -d "$BACKUP_DIR/implementation" ]; then
    while IFS= read -r -d '' backup_file; do
      local filename
      filename=$(basename "$backup_file" .bak)
      local target_file="src/main/mule/implementation/$filename"
      if [ -f "$backup_file" ]; then
        cp "$backup_file" "$target_file"
      fi
    done < <(find "$BACKUP_DIR/implementation" -type f -name "*.xml.bak" -print0 2>/dev/null || true)
  fi
}

update_pom_version() {
  local env=$1
  local version=${2:-}

  print_info "Updating pom.xml for $env environment..."

  # Get current version if not provided
  if [ -z "$version" ]; then
    version=$(grep -m1 '<version>' pom.xml | sed 's/.*<version>\(.*\)<\/version>.*/\1/')
  fi

  # Update version (only the first occurrence which is the project version)
  sed -i.tmp "0,/<version>.*<\/version>/s|<version>.*</version>|<version>$version</version>|" pom.xml

  # Update project name based on environment (artifactId remains unchanged)
  if [ "$env" == "sandbox" ]; then
    sed -i.tmp "s|<name>.*</name>|<name>${PROJECT_NAME}-sandbox-${version}</name>|" pom.xml || true
  else
    sed -i.tmp "s|<name>.*</name>|<name>${PROJECT_NAME}-production-${version}</name>|" pom.xml || true
  fi

  rm -f pom.xml.tmp
}

create_sandbox_global() {
  print_info "Creating sandbox version of configuration files..."
  local global_file="src/main/mule/global.xml"

  # Prefer targeted utility if available
  if command -v create_targeted_sandbox_config >/dev/null 2>&1; then
    create_targeted_sandbox_config "$global_file"
  else
    print_info "Using manual configuration approach..."
    # Remove secure:: prefixes from properties in global.xml (${secure::property} format)
    if grep -q "secure::" "$global_file"; then
      print_info "Removing secure:: prefixes from global.xml properties..."
      sed -i.tmp 's/\${secure::/\${/g' "$global_file"
      rm -f "${global_file}.tmp"
      print_info "\xE2\x9C\x93 Removed secure:: prefixes from global.xml"
    fi
    # Remove secure-properties config block
    if grep -q "secure-properties:config" "$global_file"; then
      print_info "Removing secure-properties configuration..."
      perl -i -pe 'BEGIN{undef $/;} s/<secure-properties:config[^>]*>.*?<\/secure-properties:config>//smg' "$global_file"
      print_info "\xE2\x9C\x93 Removed secure-properties configuration"
    fi

    # Validate XML if xmllint is available
    if command -v xmllint >/dev/null 2>&1; then
      if xmllint --noout "$global_file" 2>/dev/null; then
        print_info "\xE2\x9C\x93 XML structure is valid after sandbox changes"
      else
        print_warning "XML structure validation failed; please review $global_file"
      fi
    fi
  fi

  # Handle secure:: in DataWeave scripts across all implementation files
  print_info "Removing secure:: prefixes from DataWeave scripts in implementation files..."
  local impl_dir="src/main/mule/implementation"
  if [ -d "$impl_dir" ]; then
    # Find all XML files in implementation directory and subdirectories
    local changed_count=0
    while IFS= read -r -d '' file; do
      if grep -q "Mule::p('secure::" "$file" 2>/dev/null; then
        # Replace Mule::p('secure::property') with Mule::p('property')
        sed -i.tmp "s/Mule::p('secure::/Mule::p('/g" "$file"
        rm -f "${file}.tmp"
        changed_count=$((changed_count + 1))
        print_info "  \xE2\x9C\x93 Updated $(basename "$file")"
      fi
    done < <(find "$impl_dir" -type f -name "*.xml" -print0)
    
    if [ $changed_count -gt 0 ]; then
      print_info "\xE2\x9C\x93 Removed secure:: prefixes from $changed_count implementation files"
    else
      print_info "No DataWeave secure:: references found in implementation files"
    fi
  fi

  # Verify changes
  local remaining_secure
  remaining_secure=$(grep -r "secure::" src/main/mule/ 2>/dev/null | wc -l || echo "0")
  if [ "$remaining_secure" -eq 0 ]; then
    print_info "\xE2\x9C\x93 Successfully configured for sandbox deployment (no secure properties)"
  else
    print_warning "Some secure:: references may still remain ($remaining_secure occurrences)"
  fi
}

create_production_global() {
  # Optional: enforce secure prefixes for sensitive props in production
  if [ "$ENFORCE_SECURE" != true ]; then
    print_info "Production build: leaving configuration files as-is (secure properties preserved if present)."
    return 0
  fi

  local global_file="src/main/mule/global.xml"
  print_info "Enforcing secure prefixes for sensitive properties in production..."

  if command -v create_production_config >/dev/null 2>&1; then
    create_production_config "$global_file"
  else
    print_info "Using manual secure enforcement for common properties..."
    
    # Define sensitive properties
    local props=(
      'netsuite.consumerKey'
      'netsuite.consumerSecret'
      'netsuite.tokenId'
      'netsuite.tokenSecret'
      'netsuite.accountId'
      'salesforce.username'
      'salesforce.password'
      'salesforce.token'
    )
    
    # Add secure:: to global.xml if not already present (${prop} format)
    for p in "${props[@]}"; do
      sed -i.bak "s/\${${p}}/\${secure::${p}}/g" "$global_file" || true
    done
    rm -f "${global_file}.bak"
    print_info "\xE2\x9C\x93 Enforced secure:: in global.xml"
    
    # Add secure:: to DataWeave scripts in implementation files if not already present
    local impl_dir="src/main/mule/implementation"
    if [ -d "$impl_dir" ]; then
      print_info "Enforcing secure:: prefixes in DataWeave scripts..."
      local changed_count=0
      while IFS= read -r -d '' file; do
        local file_changed=false
        for p in "${props[@]}"; do
          # Check if property exists without secure:: prefix
          if grep -q "Mule::p('${p}')" "$file" 2>/dev/null; then
            sed -i.bak "s/Mule::p('${p}')/Mule::p('secure::${p}')/g" "$file"
            file_changed=true
          fi
        done
        if [ "$file_changed" = true ]; then
          rm -f "${file}.bak"
          changed_count=$((changed_count + 1))
          print_info "  \xE2\x9C\x93 Enforced secure:: in $(basename "$file")"
        fi
      done < <(find "$impl_dir" -type f -name "*.xml" -print0)
      
      if [ $changed_count -gt 0 ]; then
        print_info "\xE2\x9C\x93 Enforced secure:: in $changed_count implementation files"
      fi
    fi
  fi
}

clean_build() {
  print_info "Cleaning build artifacts..."
  mvn clean -q || true
  rm -rf "$TARGET_DIR"
}

build_package() {
  local env=$1
  print_info "Building $env package..."

  # Set Maven properties for the environment
  if [ "$env" == "sandbox" ]; then
    mvn package -Dmule.env=dev -DskipTests -q
  else
    mvn package -Dmule.env=prod -DskipTests -q
  fi

  # Find the generated JAR file (look for mule-application.jar specifically)
  local jar_file
  jar_file=$(find "$TARGET_DIR" -name "*-mule-application.jar" -type f | head -1 || true)
  if [ ! -f "${jar_file:-}" ]; then
    jar_file=$(find "$TARGET_DIR" -maxdepth 1 -name "*.jar" -type f | head -1 || true)
  fi

  if [ -f "${jar_file:-}" ]; then
    print_info "Package built successfully: $jar_file"

    local current_version
    current_version=$(grep -m1 '<version>' pom.xml | sed 's/.*<version>\(.*\)<\/version>.*/\1/')

    local timestamp
    timestamp=$(date +"%Y%m%d_%H%M%S")
    local new_name="${PROJECT_NAME}-${env}-${current_version}-${timestamp}.jar"
    local new_path="$TARGET_DIR/$new_name"

    cp "$jar_file" "$new_path"
    print_info "Package renamed to: $new_name"

    cat > "$TARGET_DIR/deployment-info.txt" << EOF
Package Information:
-------------------
Environment: $env
Package Name: $new_name
Build Date: $(date)
Version: $current_version
Built By: $(whoami)
Machine: $(hostname)

Configuration Changes Applied:
EOF

    if [ "$env" == "sandbox" ]; then
      echo "- Secure properties removed from global.xml (secure:: prefixes stripped)" >> "$TARGET_DIR/deployment-info.txt"
      echo "- Secure properties removed from all implementation flow files" >> "$TARGET_DIR/deployment-info.txt"
      echo "  * Converted Mule::p('secure::property') to Mule::p('property')" >> "$TARGET_DIR/deployment-info.txt"
      echo "  * Files processed: netsuiteRest.xml, netsuiteVCARestlet.xml, and others" >> "$TARGET_DIR/deployment-info.txt"
    else
      if [ "$ENFORCE_SECURE" = true ]; then
        echo "- Enforced secure:: prefixes for sensitive properties in global.xml" >> "$TARGET_DIR/deployment-info.txt"
        echo "- Enforced secure:: prefixes in DataWeave scripts in implementation files" >> "$TARGET_DIR/deployment-info.txt"
      else
        echo "- Production configuration left as-is (secure properties preserved if present)" >> "$TARGET_DIR/deployment-info.txt"
      fi
    fi

    echo "" >> "$TARGET_DIR/deployment-info.txt"
    echo "Original JAR: $(basename "$jar_file")" >> "$TARGET_DIR/deployment-info.txt"
    echo "Final Package: $new_name" >> "$TARGET_DIR/deployment-info.txt"
  else
    print_error "Build failed! No JAR file found in $TARGET_DIR"
    exit 1
  fi
}

validate_environment() {
  local env=$1
  if [ "$env" != "sandbox" ] && [ "$env" != "production" ]; then
    print_error "Invalid environment: $env"
    print_error "Environment must be either 'sandbox' or 'production'"
    show_usage
    exit 1
  fi
}

main() {
  print_info "Starting Mule Application Build Process"

  if [ $# -eq 0 ]; then
    print_error "No arguments provided"
    show_usage
    exit 1
  fi

  # Parse args
  ENVIRONMENT="$1"; shift || true
  while (( "$#" )); do
    case "$1" in
      --enforce-secure)
        ENFORCE_SECURE=true; shift ;;
      *)
        if [ -z "${VERSION}" ]; then VERSION="$1"; shift; else shift; fi ;;
    esac
  done

  validate_environment "$ENVIRONMENT"

  # Determine project name dynamically
  PROJECT_NAME=$(get_project_name_from_pom)
  print_info "Detected project name: $PROJECT_NAME"

  # Ensure we restore files on exit
  trap restore_files EXIT

  backup_files
  clean_build

  if [ "$ENVIRONMENT" == "sandbox" ]; then
    create_sandbox_global
    print_info "Configured for SANDBOX deployment (credentials embedded in configuration)"
  else
    create_production_global
    print_info "Configured for PRODUCTION deployment"
  fi

  update_pom_version "$ENVIRONMENT" "${VERSION:-}"
  build_package "$ENVIRONMENT"

  print_info "Build completed successfully for $ENVIRONMENT environment!"
  print_info "Check the $TARGET_DIR directory for the generated package and deployment info."
}

main "$@"
