/**
 * File System Access API 的类型补丁。
 * 当前 TS lib.dom 已含 FileSystemDirectoryHandle / FileSystemFileHandle /
 * FileSystemWritableFileStream，但缺少 showDirectoryPicker 与
 * FileSystemHandle 的权限方法。这里用声明合并补齐，避免业务代码 any。
 */

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
