"""Prepara solo la distribucion WSL propia. No opera el firewall Windows."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def run(args, **kw):
    subprocess.run(args, check=True, **kw)


def progress(message):
    print('[DLP] ' + message, flush=True)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--source',required=True); args=parser.parse_args()
    source=Path(args.source).resolve(); target=Path('/root/dlp')
    if not (source/'package.json').is_file() or not (source/'.env').is_file():
        raise RuntimeError('Ejecuta setup primero y proporciona la carpeta del proyecto.')
    # El comando cliente puede venir de Docker Desktop a traves de WSL interop;
    # necesitamos el daemon Linux propio de esta distribucion.
    if not shutil.which('dockerd'):
        progress('Instalando Docker dentro de la distribucion del laboratorio.')
        env={**os.environ,'DEBIAN_FRONTEND':'noninteractive'}
        run(['apt-get','update','-qq'],env=env)
        run(['apt-get','install','-y','--no-install-recommends','docker.io','docker-compose-v2','ca-certificates'],env=env)
    progress('Iniciando Docker.')
    run(['service','docker','start'])
    target.mkdir(mode=0o700,exist_ok=True)
    manager_files=['deploy/wazuh/manager.conf','deploy/wazuh/dlp-rules.xml','deploy/wazuh/dlp-decoders.xml']
    manager_changed=any(not (target/p).exists() or (source/p).read_bytes() != (target/p).read_bytes() for p in manager_files)
    excluded={'.git','.venv','node_modules','tmp','laboratorio','datos-control','datos-endpoint','__pycache__','state','certs','recibidos','logs'}
    progress('Sincronizando el proyecto con /root/dlp.')
    shutil.copytree(source,target,dirs_exist_ok=True,ignore=lambda _,names:[n for n in names if n in excluded or n.endswith('.pyc')])
    os.chmod(target,0o700); os.chmod(target/'.env',0o600)
    state=target/'deploy/state'; state.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source/'deploy/state/authd.pass',state/'authd.pass'); os.chmod(state/'authd.pass',0o600)
    base=['docker','compose','--parallel','1','--env-file','.env','-f','deploy/compose.yaml','--profile','extended','--profile','wazuh']
    # Escucha dentro de WSL; Windows limita el acceso al laboratorio mediante su red.
    env={**os.environ,'DLP_LAB_BIND':'0.0.0.0','BUILDKIT_PROGRESS':'plain','COMPOSE_PROGRESS':'plain'}
    progress('Construyendo imagenes. Las descargas iniciales requieren Internet; las capas completadas se reutilizan.')
    run(base+['build'],cwd=target,env=env)
    progress('Iniciando contenedores.')
    run(base+['up','-d','--no-build'],cwd=target,env=env)
    if manager_changed:
        run(base+['restart','wazuh-manager'],cwd=target,env=env)
    progress('Servicios DLP desplegados dentro de WSL.')


if __name__=='__main__': main()
