export default function Header({ onHelpOpen }) {
    return (
        <header className="header">
            <h1>rd-surface</h1>
            <p>Gray-Scott reaction diffusion on 3D meshes</p>
            <button className="help-btn" onClick={onHelpOpen} title="Help">?</button>
        </header>
    );
}
