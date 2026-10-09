import {cp, mkdir, rm, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public');
await rm(output, {recursive:true,force:true});
await mkdir(output, {recursive:true});
for (const directory of ['assets','pages']) await cp(join(root,directory), join(output,directory), {recursive:true});
for (const file of ['index.html','text-drop.html']) await copyFile(join(root,file), join(output,file));
console.log('Built the existing pages and Text Drop.');
